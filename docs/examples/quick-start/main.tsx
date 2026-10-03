import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from './app.js';

// What each action does in your editor; this one only says which ran.
const run = (action: string) => console.log(`${action} ran`);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Editor run={run} />
    </StrictMode>,
  );
}
