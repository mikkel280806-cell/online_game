import { PLAYER_HP, type Combat } from '../game/combat';
import { ROLES, type RoleId } from '../game/roles';
import { h } from './dom';

const ABILITIES: Record<RoleId, { attack: string; skill: string }> = {
  vanguard: { attack: 'Strike', skill: 'Shield (hold)' },
  tether: { attack: 'Pulse shot', skill: 'Gravity pulse' },
};

/** Health bars, ability keys with cooldowns, the downed notice and the hurt flash. */
export class CombatHud {
  private readonly root: HTMLDivElement;
  private readonly bars: Record<'me' | 'partner', { el: HTMLDivElement; name: HTMLDivElement; fill: HTMLDivElement }>;
  private readonly attack: HTMLDivElement;
  private readonly skill: HTMLDivElement;
  private readonly down: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private role: RoleId | null = null;

  constructor(parent: HTMLElement) {
    const bar = () => {
      const name = h('div.vital-name');
      const fill = h('div.vital-fill');
      const el = h('div.vital', {}, name, h('div.vital-track', {}, fill));
      return { el, name, fill };
    };
    this.bars = { me: bar(), partner: bar() };
    this.attack = h('div.ability');
    this.skill = h('div.ability');
    const dash = h('div.ability', {}, h('kbd', { text: 'Space' }), ' Dash');
    this.down = h('div.downed.hidden', { text: 'You are down. Your partner can revive you: they hold F beside you.' });
    this.flash = h('div.hurt-flash');
    this.root = h(
      'div.combat-hud.hidden',
      {},
      h('div.vitals.panel', {}, this.bars.me.el, this.bars.partner.el),
      h('div.abilities.panel', {}, this.attack, this.skill, dash),
    );
    parent.append(this.flash, this.down, this.root);
  }

  update(visible: boolean, combat: Combat, me: RoleId | null, partner: RoleId | null, hurt: number): void {
    this.root.classList.toggle('hidden', !visible || !me);
    this.flash.style.opacity = visible ? String(Math.min(0.55, hurt * 0.55)) : '0';
    if (!visible || !me) {
      this.down.classList.add('hidden');
      return;
    }
    if (this.role !== me) {
      this.role = me;
      this.attack.replaceChildren(h('kbd', { text: 'R' }), ` ${ABILITIES[me].attack}`);
      this.skill.replaceChildren(h('kbd', { text: 'C' }), ` ${ABILITIES[me].skill}`);
    }
    const show = (which: 'me' | 'partner', role: RoleId | null) => {
      const b = this.bars[which];
      b.el.classList.toggle('hidden', !role);
      if (!role) return;
      const v = combat.vitals[role];
      b.name.textContent = `${ROLES[role].name}${v.downed ? ' · DOWN' : ''}`;
      b.name.style.color = ROLES[role].css;
      b.fill.style.width = `${(v.downed ? v.revive : v.hp / PLAYER_HP) * 100}%`;
      b.fill.classList.toggle('reviving', v.downed);
    };
    show('me', me);
    show('partner', partner);
    const v = combat.vitals[me];
    this.attack.classList.toggle('cooling', v.attackCd > 0);
    this.skill.classList.toggle('cooling', v.skillCd > 0);
    this.down.classList.toggle('hidden', !v.downed);
  }
}
