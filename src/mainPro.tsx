import React from 'react';
import ReactDOM from 'react-dom/client';
import AppPro from './AppPro.tsx';
import './index.css';

(function initializeDarkMode() {
  const saved = localStorage.getItem('darkMode');
  let isDark: boolean;

  if (saved !== null) {
    isDark = saved === 'true';
  } else {
    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  const root = document.documentElement;
  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
})();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppPro />
  </React.StrictMode>
);
