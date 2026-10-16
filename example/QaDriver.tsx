// TEMPORARY verification harness — delete after the device checks.
import { useEffect } from 'react';
import { useTour } from 'rn-smart-tour';

/** Runs every scenario on a fixed timeline (ms after mount); screenshots are matched by the status line. */
export const QaDriver = ({ openDetails }: { openDetails: () => void }) => {
  const { startTour, nextStep, stopTour } = useTour();
  useEffect(() => {
    const plan: Array<[number, () => void]> = [
      [4000, () => stopTour()], // welcome auto-started; dismiss it
      [5000, () => startTour('cross', { force: true })],
      [9000, nextStep], // -> Details
      [14000, nextStep], // -> back to Home
      [19000, () => stopTour()],
      [20000, () => startTour('scroll', { force: true })],
      [24000, nextStep], // -> row 25
      [29000, () => stopTour()],
      [30000, openDetails],
      [33000, () => startTour('titleOnly', { force: true })],
      [37000, () => stopTour()],
    ];
    const timers = plan.map(([ms, fn]) => setTimeout(fn, ms));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};
