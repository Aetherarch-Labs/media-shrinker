import { useState, useEffect } from 'react';

// Initialize dark mode immediately (before React renders)
function initializeDarkMode(): boolean {
  // Check localStorage first
  const saved = localStorage.getItem('darkMode');
  let isDark: boolean;
  
  if (saved !== null) {
    isDark = saved === 'true';
  } else {
    // Check system preference
    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  
  // Set the class immediately
  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  
  return isDark;
}

export function useDarkMode() {
  const [isDark, setIsDark] = useState(initializeDarkMode);

  useEffect(() => {
    // Update document class and localStorage when state changes
    const root = document.documentElement;
    
    if (isDark) {
      root.classList.add('dark');
      localStorage.setItem('darkMode', 'true');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('darkMode', 'false');
    }
  }, [isDark]);

  const toggleDarkMode = () => {
    setIsDark(prev => !prev);
  };

  return { isDark, toggleDarkMode };
}
