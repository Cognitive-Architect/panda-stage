import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ExportRendererApp } from './ExportRendererApp';
import '../renderer/styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Export renderer root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <ExportRendererApp />
  </StrictMode>,
);
