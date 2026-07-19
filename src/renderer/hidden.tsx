import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HiddenApp } from './HiddenApp';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Hidden renderer root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <HiddenApp />
  </StrictMode>,
);
