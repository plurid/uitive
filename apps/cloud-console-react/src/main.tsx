import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { defineElements } from '@plurid/aptuitive-dom';
import { defineDebugElement } from '@plurid/aptuitive-dom/debug';
import { App } from './app.tsx';
import '../../shared/demo.css';
import './styles.css';

defineElements();
defineDebugElement();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
