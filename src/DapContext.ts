import { createContext } from 'react';
import type { DapContextType } from './types';

export const DapContext = createContext<DapContextType | null>(null);
