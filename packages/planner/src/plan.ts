import {
  areasOf,
  hash,
  MAX_ACTIONS,
  MAX_SOURCES,
  rankAreas,
  selectSubset,
  sourcesInView,
  terms,
  validateOutput,
  type AnyContract,
  type Planner,
  type PlanProgress,
  type PlanRequest,
  type PlanResult,
  type Subset,
} from '@plurid/uitive-core';
import { formText, parseAnswer, schemaProblems } from './answer.js';
import { PlannerError, type Model, type ModelMessage, type ModelUsage } from './model.js';
import { repairText, toOperations, type PlannerOutput } from './output.js';
import { contractText, requestText, RULES } from './prompt.js';
import { outputSchema, size } from './schema.js';

/** How `modelPlanner` plans: with which model, and how much it may write. */
export interface ModelPlannerOptions {
  /**
   * The model that plans, such as `anthropic()`, `openai({ model: 'gpt-6.1-sol' })`,
   * `google({ model: 'gemini-3.8-flash' })` or one of your own.
   */
  model: Model;
  /** Most tokens the model may write, thinking included. @default 16000 */
  maxTokens?: number;
}

/** Prepared schemas and prompts kept, by contract and subset. */
const PREPARED = 32;

/**
 * Values one enum may hold before a request is scoped, however few sources the contract has:
 * ADR 0005 keeps enums to a few hundred values, as `uitive check` measures them.
 */
const MAX_ENUM = 400;

interface Prepared {
  schema: Record<string, unknown>;
  contract: string;
  largestEnum: number;
}

/**
 * Plans with a language model from any provider. The contract compiles to the schema the answer
 * must follow, so a model that keeps to it can only name what the application offers; answers are
 * checked against it all the same. Large contracts, by sources or by the size of their enums, are
 * first scoped to the areas a request needs, and each scope's schema and prompt are prepared once,
 * so providers' caches stay warm. An answer that strays from the schema, or that policy would
 * partly reject, goes back once for repair; when the repair fails, what policy accepted of the
 * first answer stands.
 */
export function modelPlanner(options: ModelPlannerOptions): Planner {
  const { model } = options;
  const prepared = new Map<string, Prepared>();

  const prepare = (contract: AnyContract, subset: Subset | undefined, native: boolean) => {
    // A subset's actions depend on the request's words, not only on its sources.
    const key = hash([
      contract.hash,
      subset?.sources ?? null,
      subset === undefined ? null : [...subset.actions].sort(),
      native,
    ]);
    const found = prepared.get(key);
    if (found) {
      prepared.delete(key);
      prepared.set(key, found);
      return found;
    }
    const schema = outputSchema(contract, { ...(subset === undefined ? {} : { subset }), native });
    // A model that doesn't constrain its answer reads the schema instead.
    const form =
      model.structured === 'schema'
        ? ''
        : `\n\nAnswer with one JSON object and nothing else. It must follow this JSON Schema:\n${JSON.stringify(schema)}`;
    const fresh: Prepared = {
      schema,
      contract: `${contractText(contract, subset, { native })}${form}`,
      largestEnum: size(schema).largestEnum,
    };
    prepared.set(key, fresh);
    if (prepared.size > PREPARED) prepared.delete(prepared.keys().next().value as string);
    return fresh;
  };

  /** The part of a contract a request plans over: all of it, when its schema is within limits. */
  const scope = (contract: AnyContract, text: string, inView: readonly string[]) => {
    if (contract.sourceIds.length > MAX_SOURCES) return selectSubset(contract, { text, inView });
    if (prepare(contract, undefined, true).largestEnum <= MAX_ENUM) return undefined;
    return withNamedActions(contract, selectSubset(contract, { text, inView }), text);
  };

  return {
    name: model.provider,
    async plan(request: PlanRequest, contract: AnyContract, planOptions = {}) {
      const started = Date.now();
      const words = [request.text, request.goal].filter(Boolean).join(' ');
      const inView = sourcesInView(contract, request);
      let subset = scope(contract, words, inView);
      let native = true;
      let ready = prepare(contract, subset, native);
      const messages: ModelMessage[] = [{ role: 'user', content: requestText(request) }];
      const usage: ModelUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      let cost: number | undefined;
      let answeredBy = model.name;
      let stages = 0;

      /** One answer from the model, parsed: or the text and why it isn't a plan. */
      const ask = async (
        stage: PlanProgress['stage'],
      ): Promise<{ text: string; output?: PlannerOutput; problems: string[] }> => {
        for (let attempt = 0; ; attempt++) {
          stages++;
          planOptions.onProgress?.({ stage, elements: 0 });
          let counted = 0;
          let reply;
          try {
            reply = await model.generate({
              rules: RULES,
              contract: ready.contract,
              messages,
              schema: ready.schema,
              maxTokens: options.maxTokens ?? 16_000,
              ...(planOptions.signal === undefined ? {} : { signal: planOptions.signal }),
              onText: (snapshot) => {
                const elements = snapshot.split('"block"').length - 1;
                if (elements !== counted) {
                  counted = elements;
                  planOptions.onProgress?.({ stage, elements });
                }
              },
            });
          } catch (error) {
            const tooComplex = error instanceof PlannerError && error.reason === 'too-complex';
            if (attempt === 0 && stage === 'planning' && tooComplex) {
              // A schema too big for the provider: once more with half the sources and no native blocks.
              subset = halved(contract, subset, words, inView);
              native = false;
              ready = prepare(contract, subset, native);
              continue;
            }
            throw error;
          }
          usage.input += reply.usage.input;
          usage.output += reply.usage.output;
          usage.cacheRead += reply.usage.cacheRead;
          usage.cacheWrite += reply.usage.cacheWrite;
          if (reply.cost !== undefined) cost = (cost ?? 0) + reply.cost;
          answeredBy = reply.model;
          if (reply.stop === 'refused')
            throw new PlannerError('The model declined this request', 502);
          if (reply.stop === 'cut') throw new PlannerError('The plan was cut short', 502);
          let parsed: unknown;
          try {
            parsed = parseAnswer(reply.text);
          } catch {
            return { text: reply.text, problems: ['/: the answer is not JSON'] };
          }
          const problems = schemaProblems(ready.schema, parsed);
          return problems.length === 0
            ? { text: reply.text, output: parsed as PlannerOutput, problems }
            : { text: reply.text, problems };
        }
      };

      const answer = await ask('planning');
      let output = answer.output;
      let operations = output ? toOperations(output, request.kind) : [];
      const checked = output ? validateOutput(contract, operations) : undefined;
      let repaired = false;
      let unrepaired: string | undefined;
      if (!output || (checked !== undefined && checked.rejected.length > 0)) {
        // One more round: the answer as given, and what to fix in it.
        messages.push(
          { role: 'assistant', content: answer.text },
          {
            role: 'user',
            content: checked ? repairText(checked.rejected) : formText(answer.problems),
          },
        );
        let again: Awaited<ReturnType<typeof ask>> | undefined;
        try {
          again = await ask('repairing');
        } catch (error) {
          // A failed repair still leaves the first answer's valid part, unless the caller left.
          const canceled = (planOptions.signal as { aborted?: boolean } | undefined)?.aborted;
          if (!checked || !(error instanceof PlannerError) || error.status === 499 || canceled) {
            throw error;
          }
          unrepaired = error.publicMessage;
        }
        if (again?.output) {
          output = again.output;
          operations = toOperations(output, request.kind);
          repaired = true;
        } else if (output && checked) {
          operations = checked.accepted;
          unrepaired ??= "The repaired answer didn't follow the plan's form";
        } else {
          throw new PlannerError(
            "The model's answer didn't follow the plan's form, even when asked again",
            502,
          );
        }
      }
      const result: PlanResult = {
        origin: 'model',
        operations,
        status: output.status,
        ...(output.candidates.length > 0 ? { candidates: output.candidates } : {}),
        meta: {
          planner: model.provider,
          model: answeredBy,
          ms: Date.now() - started,
          usage,
          ...(cost === undefined ? {} : { cost: Math.round(cost * 10_000) / 10_000 }),
          ...(subset === undefined ? {} : { subset: [...subset.sources] }),
          ...(repaired ? { repaired } : {}),
          ...(unrepaired === undefined ? {} : { unrepaired }),
          stages,
        },
      };
      return result;
    },
  };
}

/**
 * A subset for a contract with few sources but more actions than an enum should hold: as for a
 * large contract, its areas' actions and those the words name, at most `MAX_ACTIONS`.
 */
function withNamedActions(contract: AnyContract, subset: Subset, text: string): Subset {
  const tied = new Set(areasOf(contract).flatMap((area) => area.actions));
  const loose = contract.actionIds
    .filter((id) => !tied.has(id))
    .map((id) => {
      const spec = contract.actions[id];
      return {
        source: id,
        actions: [],
        routes: [],
        terms: terms(`${id} ${spec?.label ?? ''} ${spec?.description ?? ''} ${spec?.group ?? ''}`),
      };
    });
  const named = rankAreas(loose, text).map((entry) => entry.source);
  return { ...subset, actions: [...new Set([...subset.actions, ...named])].slice(0, MAX_ACTIONS) };
}

/**
 * Half of a request's sources, for a provider that found its schema too big: those retrieval
 * picks, then the first of the sources it had, so never none when there were some.
 */
function halved(
  contract: AnyContract,
  subset: Subset | undefined,
  text: string,
  inView: readonly string[],
): Subset {
  const had = subset?.sources ?? contract.sourceIds;
  const half = Math.max(1, Math.ceil(had.length / 2));
  const found = selectSubset(contract, { text, inView, maxSources: half, extra: half });
  if (found.sources.length >= half || found.sources.length === contract.sourceIds.length) {
    return found;
  }
  const keep = [...new Set([...found.sources, ...had])].slice(0, half);
  return selectSubset(contract, { text, inView: keep, maxSources: half, extra: 0 });
}
