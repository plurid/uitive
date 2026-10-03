import {
  hash,
  MAX_SOURCES,
  selectSubset,
  sourcesInView,
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
import { outputSchema } from './schema.js';

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

interface Prepared {
  schema: Record<string, unknown>;
  contract: string;
}

/**
 * Plans with a language model from any provider. The contract compiles to the schema the answer
 * must follow, so a model that keeps to it can only name what the application offers; answers are
 * checked against it all the same. Large contracts are first scoped to the areas a request needs,
 * and each scope's schema and prompt are prepared once, so providers' caches stay warm. An answer
 * that strays from the schema, or that policy would partly reject, goes back once for repair.
 */
export function modelPlanner(options: ModelPlannerOptions): Planner {
  const { model } = options;
  const prepared = new Map<string, Prepared>();

  const prepare = (contract: AnyContract, subset: Subset | undefined, native: boolean) => {
    const key = hash([contract.hash, subset?.sources ?? null, native]);
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
    const fresh: Prepared = { schema, contract: `${contractText(contract, subset)}${form}` };
    prepared.set(key, fresh);
    if (prepared.size > PREPARED) prepared.delete(prepared.keys().next().value as string);
    return fresh;
  };

  return {
    name: model.provider,
    async plan(request: PlanRequest, contract: AnyContract, planOptions = {}) {
      const started = Date.now();
      const words = [request.text, request.goal].filter(Boolean).join(' ');
      const inView = sourcesInView(contract, request);
      let subset =
        contract.sourceIds.length > MAX_SOURCES
          ? selectSubset(contract, { text: words, inView })
          : undefined;
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
              const half = Math.max(
                1,
                Math.ceil((subset?.sources ?? contract.sourceIds).length / 2),
              );
              subset = selectSubset(contract, {
                text: words,
                inView,
                maxSources: half,
                extra: half,
              });
              if (subset.sources.length >= contract.sourceIds.length) {
                subset = { ...subset, sources: subset.sources.slice(0, half) };
              }
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

      let answer = await ask('planning');
      let output = answer.output;
      let operations = output ? toOperations(output) : [];
      const rejected = output ? validateOutput(contract, operations).rejected : [];
      let repaired = false;
      if (!output || rejected.length > 0) {
        // One more round: the answer as given, and what to fix in it.
        messages.push(
          { role: 'assistant', content: answer.text },
          {
            role: 'user',
            content: output ? repairText(rejected) : formText(answer.problems),
          },
        );
        answer = await ask('repairing');
        if (!answer.output) {
          throw new PlannerError(
            "The model's answer didn't follow the plan's form, even when asked again",
            502,
          );
        }
        output = answer.output;
        operations = toOperations(output);
        repaired = true;
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
          stages,
        },
      };
      return result;
    },
  };
}
