import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { defineElements } from '@plurid/uitive-dom';
import { defineDebugElement } from '@plurid/uitive-dom/debug';
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
