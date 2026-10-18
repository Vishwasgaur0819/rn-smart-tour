import { placeTooltip } from '../react/placement';

const screen = { screenWidth: 400, screenHeight: 800 };
const base = { ...screen, width: 280, cardHeight: 120 };

describe('placeTooltip', () => {
  it('puts the card below the target by default, centered on it', () => {
    const p = placeTooltip({ ...base, rect: { x: 150, y: 100, width: 100, height: 40 } });
    expect(p).toEqual({ left: 60, top: 150, width: 280 });
  });

  it('flips above when there is no room below', () => {
    const p = placeTooltip({ ...base, rect: { x: 150, y: 700, width: 100, height: 40 } });
    expect(p.top).toBe(700 - 10 - 120);
  });

  it("'top' goes above, and flips below when there is no room above", () => {
    expect(
      placeTooltip({ ...base, position: 'top', rect: { x: 0, y: 400, width: 50, height: 40 } }).top,
    ).toBe(270);
    expect(placeTooltip({ ...base, position: 'top', rect: { x: 0, y: 50, width: 50, height: 40 } }).top).toBe(
      100,
    );
  });

  it('keeps the card on screen horizontally', () => {
    expect(placeTooltip({ ...base, rect: { x: 0, y: 100, width: 20, height: 20 } }).left).toBe(16);
    expect(placeTooltip({ ...base, rect: { x: 380, y: 100, width: 20, height: 20 } }).left).toBe(
      400 - 280 - 16,
    );
  });

  it('never makes the card wider than the screen allows', () => {
    expect(placeTooltip({ ...base, width: 1000, rect: { x: 0, y: 0, width: 10, height: 10 } }).width).toBe(
      368,
    );
  });

  it("'left' / 'right' place the card beside the target, vertically centered", () => {
    const right = placeTooltip({
      ...base,
      position: 'right',
      rect: { x: 20, y: 300, width: 40, height: 40 },
    });
    expect(right).toEqual({ left: 70, top: 260, width: 280 });
    const left = placeTooltip({ ...base, position: 'left', rect: { x: 340, y: 300, width: 40, height: 40 } });
    expect(left).toEqual({ left: 340 - 10 - 280, top: 260, width: 280 });
  });

  it("'left' / 'right' fall back to below when there is no room beside the target", () => {
    const p = placeTooltip({ ...base, position: 'left', rect: { x: 40, y: 300, width: 40, height: 40 } });
    expect(p.top).toBe(350);
  });

  it('fits neither above nor below: uses the roomier side and stays on screen', () => {
    const p = placeTooltip({ ...base, rect: { x: 0, y: 60, width: 400, height: 680 } });
    expect(p.top).toBeGreaterThanOrEqual(16);
    expect(p.top + 120).toBeLessThanOrEqual(800 - 16);
  });
});
