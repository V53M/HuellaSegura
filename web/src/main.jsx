import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@radix-ui/colors/slate.css';
import '@radix-ui/colors/slate-dark.css';
import '@radix-ui/colors/indigo.css';
import '@radix-ui/colors/indigo-dark.css';
import '@radix-ui/colors/green.css';
import '@radix-ui/colors/green-dark.css';
import '@radix-ui/colors/amber.css';
import '@radix-ui/colors/amber-dark.css';
import '@radix-ui/colors/blue.css';
import '@radix-ui/colors/blue-dark.css';
import '@radix-ui/colors/red.css';
import '@radix-ui/colors/red-dark.css';
import '@radix-ui/colors/plum.css';
import '@radix-ui/colors/plum-dark.css';
import './tema.js';
import App from './App.jsx';
import './estilos.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
