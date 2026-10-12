/** Tiny DOM helper: h('div.panel', { onclick }, child, 'text'). */
type TagOf<S extends string> = S extends `${infer T}.${string}` ? T : S;
type ElementOf<S extends string> = TagOf<S> extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[TagOf<S>] : HTMLElement;

export function h<S extends string>(
  tagAndClasses: S,
  props: Partial<Record<string, unknown>> = {},
  ...children: (Node | string | null | undefined)[]
): ElementOf<S> {
  const [tag, ...classes] = tagAndClasses.split('.');
  const el = document.createElement(tag) as ElementOf<S>;
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'text') el.textContent = String(v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined) el.append(c);
  return el;
}
