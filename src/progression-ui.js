import { SKINS, getSkin } from './skins.js';
import { GUN_FINISHES, getGunFinish } from './cosmetics.js';
import { REWARDS, ownsCosmetic } from './progression.js';

const number = value => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const requirement = (kind, id) => REWARDS.find(reward => reward.kind === kind && reward.id === id)?.level;
const saveCopy = profile => profile.saveMessage || 'Saved on this device';

export function createProgressionUI({ document, onEquip }) {
  const $ = id => document.getElementById(id), listeners = [], cards = [], selectors = [];
  let profile, signature = '', flushTimer, clearTimer, noticeXP = 0, disposed = false;
  const noticeRewards = new Map();
  const make = (tag, className, text) => { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const listen = (node, event, handler) => { node.addEventListener(event, handler); listeners.push(() => node.removeEventListener(event, handler)); };
  const title = make('strong', 'progression-rank'), total = make('span', 'progression-total');
  const track = make('div', 'progression-track'), bar = make('i', ''); track.append(bar);
  const next = make('span', 'progression-next');
  $('home-progression').textContent = ''; $('home-progression').append(title, total, track, next);
  bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', 'Level progress');
  bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100');
  for (const [kind, entries, target, dataKey] of [['skin', SKINS, 'skin-grid', 'skin'], ['finish', GUN_FINISHES, 'finish-grid', 'finish']]) {
    const grid = $(target); grid.textContent = '';
    for (const item of entries) {
      const button = make('button', kind === 'skin' ? 'skin-card' : 'finish-card'); button.dataset[dataKey] = item.id;
      const swatch = make('span', kind === 'skin' ? 'skin-swatch' : 'finish-swatch');
      // Native CSS color properties also work on older WebViews.
      swatch.style.background = kind === 'skin' ? item.palette.body : item.palette?.body || '#718f93';
      swatch.style.borderColor = kind === 'skin' ? item.palette.trim : item.palette?.light || '#b7ced2';
      const label = make('span', 'cosmetic-label'); button.append(swatch, label); grid.append(button);
      cards.push({ button, label, kind, item });
      listen(button, 'click', () => {
        if (profile && ownsCosmetic(profile.lifetimeXP, kind, item.id)) onEquip({ [kind === 'skin' ? 'skinId' : 'finishId']: item.id });
      });
    }
  }
  for (const id of ['armory-skin', 'room-skin']) {
    const select = $(id); select.textContent = '';
    const options = SKINS.map(skin => { const option = make('option', ''); option.value = skin.id; select.append(option); return { option, skin }; });
    selectors.push({ select, options });
    // Room's existing change handler uses the same guarded main selection route.
    if (id === 'armory-skin') listen(select, 'change', () => {
      if (profile && ownsCosmetic(profile.lifetimeXP, 'skin', select.value)) onEquip({ skinId: select.value });
      else if (profile) select.value = profile.skinId;
    });
  }
  const toast = $('progression-toast'); toast.style.pointerEvents = 'none';
  return {
    render(view, context) {
      if (disposed) return;
      profile = view;
      const key = JSON.stringify([view, context]); if (key === signature) return; signature = key;
      const { rank, lifetimeXP } = view;
      title.textContent = `Level ${rank.level}`; total.textContent = `${number(lifetimeXP)} lifetime XP`;
      const percent = rank.levelCost ? Math.floor(rank.intoLevel / rank.levelCost * 100) : 100;
      bar.style.width = `${percent}%`; bar.setAttribute('aria-valuenow', String(percent));
      next.textContent = rank.nextReward ? `${number(rank.intoLevel)} / ${number(rank.levelCost)} XP · Next: ${rank.nextReward.name}` : 'All rewards unlocked';
      for (const { button, label, kind, item } of cards) {
        const owned = ownsCosmetic(lifetimeXP, kind, item.id), selected = view[kind === 'skin' ? 'skinId' : 'finishId'] === item.id;
        button.disabled = !owned; button.setAttribute('aria-disabled', String(!owned)); button.setAttribute('aria-pressed', String(selected));
        button.classList.toggle('selected', selected); button.classList.toggle('locked', !owned);
        label.textContent = owned ? item.name : `${item.name} · Level ${requirement(kind, item.id)}`;
        button.setAttribute('aria-label', label.textContent);
      }
      for (const { select, options } of selectors) {
        for (const { option, skin } of options) {
          option.disabled = !ownsCosmetic(lifetimeXP, 'skin', skin.id);
          option.textContent = skin.name + (option.disabled ? ` · Level ${requirement('skin', skin.id)}` : '');
        }
        select.value = view.skinId;
      }
      const desired = `${getSkin(view.skinId).name} / ${getGunFinish(view.finishId).name}`;
      const current = `${getSkin(context.currentSkinId || view.skinId).name} / ${getGunFinish(context.currentFinishId || view.finishId).name}`;
      $('appearance-timing').textContent = context.live
        ? `${context.modeId === 'range' ? 'Next visit' : context.modeId === 'zombies' ? 'Next run' : 'Next respawn'} · Selected: ${desired} · Wearing: ${current}` : `Equipped: ${desired}`;
      for (const id of ['progression-save-status', 'armory-save-status', 'progression-live-save-status']) {
        const node = $(id); node.textContent = saveCopy(view); node.dataset.saveStatus = view.saveStatus;
        node.hidden = id === 'progression-live-save-status' && (!context.live || view.saveStatus === 'saved');
      }
    },
    renderResults(summary, view) {
      const result = $('results-progression'); result.textContent = '';
      if (!summary) { result.append(make('p', '', `No XP earned · ${saveCopy(view)}`)); return; }
      const tally = summary.tally;
      result.append(make('strong', '', `+${number(summary.creditedXP)} XP this round`));
      const rows = [['Eliminations', tally.eliminations, 10], ['Zombies', tally.zombieKills, 2], ['Captures', tally.flagCaptures, 50], ['Flag returns', tally.flagReturns, 10], ['Waves', tally.wavesCleared, 25], ['Match finish', tally.completed ? 1 : 0, 50], ['Win', tally.won ? 1 : 0, 25]];
      result.append(make('p', '', rows.filter(([, count]) => count > 0).map(([label, count, rate]) => `${label} +${number(count * rate)}`).join(' · ') || 'No scoring actions'));
      if (summary.newRewards.length) result.append(make('p', '', `Unlocked: ${summary.newRewards.map(r => r.name).join(', ')}`));
      result.append(make('small', '', `Level ${view.rank.level} · ${number(view.lifetimeXP)} lifetime XP · ${saveCopy(view)}`));
    },
    notify(delta, view) {
      if (disposed || (!delta.creditedXP && !delta.newRewards.length)) return;
      noticeXP += delta.creditedXP; for (const reward of delta.newRewards) noticeRewards.set(`${reward.kind}:${reward.id}`, reward);
      if (flushTimer !== undefined) return;
      flushTimer = setTimeout(() => {
        flushTimer = undefined; clearTimeout(clearTimer);
        toast.textContent = `+${number(noticeXP)} XP` + (noticeRewards.size ? ` · Unlocked: ${[...noticeRewards.values()].map(r => r.name).join(', ')}` : '');
        noticeXP = 0; noticeRewards.clear();
        clearTimer = setTimeout(() => { toast.textContent = ''; }, 3500);
      }, 250);
    },
    dispose() { disposed = true; clearTimeout(flushTimer); clearTimeout(clearTimer); for (const remove of listeners) remove(); toast.textContent = ''; },
  };
}
