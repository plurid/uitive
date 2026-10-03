import { useState, type FormEvent } from 'react';
import { useCommand } from '@plurid/uitive-react';
import { uitive } from './client.js';

/** Where people ask for a change in their own words; the banner says what happened. */
export function Ask() {
  const { ask, pending } = useCommand(uitive);
  const [text, setText] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await ask(text);
    setText('');
  };
  return (
    <form onSubmit={submit}>
      <input
        aria-label="Ask for a change"
        placeholder='Try "hide Bold" or "move Table to the top"'
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" disabled={pending}>
        Ask
      </button>
    </form>
  );
}
