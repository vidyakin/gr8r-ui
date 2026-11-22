/* English landing dictionary */
import type { Dict } from '../types';
import { enCore } from './core';
import { enHome } from './home';
import { enModules } from './modules';
import { enPages1 } from './pages-1';
import { enPages2 } from './pages-2';
import { enPages3 } from './pages-3';

export const en: Dict = {
  ...enCore,
  home: enHome,
  modules: enModules,
  modulePages: {
    ...enPages1,
    ...enPages2,
    ...enPages3,
  },
};
