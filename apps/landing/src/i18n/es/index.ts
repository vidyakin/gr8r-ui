/* Diccionario en español del landing */
import type { Dict } from '../types';
import { esCore } from './core';
import { esHome } from './home';
import { esModules } from './modules';
import { esPages1 } from './pages-1';
import { esPages2 } from './pages-2';
import { esPages3 } from './pages-3';

export const es: Dict = {
  ...esCore,
  home: esHome,
  modules: esModules,
  modulePages: {
    ...esPages1,
    ...esPages2,
    ...esPages3,
  },
};
