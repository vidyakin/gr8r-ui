/* Остров страницы /docs: стили интерфейса + стили документации и само приложение документации */
import { StrictMode } from 'react';
import '../styles.css';
import './docs.css';
import { DocsApp } from './DocsApp';

export default function DocsRoot() {
  return (
    <StrictMode>
      <DocsApp />
    </StrictMode>
  );
}
