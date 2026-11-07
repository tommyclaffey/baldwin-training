import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { SessionProvider } from './lib/session';
import './styles.css';
import { overflowReport } from './debug';
import { restartDemoIfRefreshed } from './lib/demo';
overflowReport();

const mount = () => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);

restartDemoIfRefreshed().finally(mount);
