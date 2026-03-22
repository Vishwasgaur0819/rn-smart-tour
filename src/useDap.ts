import { useContext } from 'react';
import { DapContext } from './DapContext';

export const useDap = () => {
  const context = useContext(DapContext);
  if (!context) {
    throw new Error('useDap must be used within a DapProvider');
  }
  return context;
};
