// Presentation only: Input owns every touch and keyboard edge.
export class HidingUI {
  constructor({ button, status }) { this.button = button; this.status = status; }
  render(view) {
    this.button.hidden = !view?.label && !view?.pending;
    this.button.disabled = !view?.enabled || !!view?.pending;
    this.button.textContent = view?.pending ? 'Waiting…' : view?.label ?? 'Hide';
    this.button.setAttribute('aria-label', this.button.textContent);
    this.status.textContent = view?.hidden ? 'Hiding' : '';
    this.status.hidden = !view?.hidden;
  }
  dispose() { this.render(null); }
}
