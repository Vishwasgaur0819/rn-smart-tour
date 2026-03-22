import React, { useContext, useEffect, useRef } from 'react';
import { ScrollView, ScrollViewProps } from 'react-native';
import { DapContext } from './DapContext';

/**
 * A wrapper for the React Native ScrollView that integrates with the rn-smart-tour
 * Auto-Scroll engine. When used, the library can automatically scroll to bring
 * tour targets into the user's view.
 */
export const DapScrollView: React.FC<ScrollViewProps> = (props) => {
  const context = useContext(DapContext);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (context?._registerScrollRef && scrollRef.current) {
      context._registerScrollRef(scrollRef.current);
    }
    return () => {
      if (context?._registerScrollRef) {
        context._registerScrollRef(null);
      }
    };
  }, [context]);

  return (
    <ScrollView
      ref={scrollRef}
      {...props}
    >
      {props.children}
    </ScrollView>
  );
};
