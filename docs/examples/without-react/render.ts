import { uitive } from './client.js';

/** Builds the menu from the person's interface, for markup the page draws itself. */
export function drawInsertMenu(menu: HTMLElement, run: (action: string) => void) {
  // #region render
  const draw = () => {
    const buttons = uitive.surface('insert').visible.map((item) => {
      const button = document.createElement('button');
      button.textContent = item.label;
      button.addEventListener('click', () => {
        uitive.record(item.id, { via: 'region', surface: 'insert' });
        run(item.id);
      });
      return button;
    });
    menu.replaceChildren(...buttons);
  };
  draw();
  return uitive.subscribe(draw);
  // #endregion
}
