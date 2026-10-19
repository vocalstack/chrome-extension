import { createRoot } from 'react-dom/client';
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '../../styles/panel.css';
import { App } from '../../ui/App';

createRoot(document.getElementById('root')!).render(<App />);
