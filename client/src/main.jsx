import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Landing from './Landing.jsx';
import './styles.css';

// Two pages, no router needed: "/" is the front page, "/app" (and anything else) the dashboard.
// Vite's dev server and any static host with an SPA fallback serve index.html for both.
const isFrontPage = window.location.pathname === '/' || window.location.pathname === '/index.html';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isFrontPage ? <Landing /> : <App />}
  </StrictMode>,
);
