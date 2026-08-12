export class ElementRegistry {
  private nextId = 1;
  private readonly idToElement = new Map<string, Element>();
  private readonly elementToId = new WeakMap<Element, string>();

  getId(element: Element): string {
    const existing = this.elementToId.get(element);
    if (existing) return existing;
    const id = `wm_${this.nextId++}`;
    this.idToElement.set(id, element);
    this.elementToId.set(element, id);
    return id;
  }

  getElement(id: string): Element | undefined {
    const element = this.idToElement.get(id);
    if (element && element.isConnected) return element;
    if (element) this.idToElement.delete(id);
    return undefined;
  }

  cleanup(): void {
    for (const [id, element] of this.idToElement) {
      if (!element.isConnected) this.idToElement.delete(id);
    }
  }
}
