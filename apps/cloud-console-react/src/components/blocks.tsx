import { useState } from 'react';
import type { BlockComponents } from '@plurid/uitive-react';
import { useCommand, useSnapshot, useSurface } from '@plurid/uitive-react';
import { verbs } from '../catalogue.ts';
import { uitive } from '../client.ts';
import { useConsole } from '../console.tsx';
import type { blocks, QuickAction } from '../contract.ts';
import { labelOf } from '../data.ts';

// The console's own blocks. Every other block on its pages is one of Uitive's, drawn from
// the contract's sources and actions with the console's kit.

const QuickActions: BlockComponents<typeof blocks>['quickActions'] = ({ props }) => {
  const { runQuick } = useConsole();
  const quick = useSurface(uitive, 'quickActions');
  const describeSteps = (value: QuickAction) =>
    value.steps.map((step) => `${verbs[step.verb][0]} ${labelOf(step.service)}`).join(' → ');
  if (quick.items.length === 0 && quick.suggestions.length === 0) {
    return (
      <p className="block-empty">
        Shortcuts appear here when you repeat the same steps, or when you ask for one, for example
        “make a button that publishes my site”.
      </p>
    );
  }
  return (
    <div className={props.style === 'list' ? 'quick list' : 'quick'}>
      {quick.items.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="quick-action"
          onClick={() => runQuick(entry.value)}
        >
          <span>{entry.title}</span>
          <span className="faint">{describeSteps(entry.value)}</span>
        </button>
      ))}
      {quick.suggestions.map((entry) => (
        <div key={entry.id} className="quick-action suggested">
          <span>{entry.title}</span>
          <span className="faint">{describeSteps(entry.value)}</span>
          <span className="quick-buttons">
            <button
              type="button"
              className="small primary"
              onClick={() => uitive.accept(entry.operation)}
            >
              Add
            </button>
            <button type="button" className="small" onClick={() => uitive.dismiss(entry.operation)}>
              Not now
            </button>
          </span>
        </div>
      ))}
    </div>
  );
};

const Goal: BlockComponents<typeof blocks>['goal'] = () => {
  const goal = useSnapshot(uitive).definition.goal;
  const command = useCommand(uitive);
  const [words, setWords] = useState('');
  if (goal !== undefined) {
    return (
      <p className="goal-said">
        You said: <q>{goal}</q>
      </p>
    );
  }
  return (
    <form
      className="goal"
      onSubmit={(event) => {
        event.preventDefault();
        if (words.trim()) void command.ask(words, { goal: true });
      }}
    >
      <label htmlFor="goal">What do you use the cloud for?</label>
      <div className="goal-row">
        <input
          id="goal"
          value={words}
          placeholder="For example: I host a website and keep an eye on costs"
          onChange={(event) => setWords(event.target.value)}
        />
        <button type="submit" className="primary" disabled={command.pending}>
          {command.pending ? 'Designing…' : 'Design my console'}
        </button>
      </div>
    </form>
  );
};

export const components: BlockComponents<typeof blocks> = {
  goal: Goal,
  quickActions: QuickActions,
};
