import { createContext } from 'react';
import { DapContextType } from './types';

export const DapContext = createContext<DapContextType | null>(null);
