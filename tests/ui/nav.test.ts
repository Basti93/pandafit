import { activeItem, HOME, menuItems, MENU_LABEL, open, showMenu } from '../../src/ui/nav';

test('the Mac menu is Fahren and Profil, nothing else', () => {
  expect(menuItems()).toEqual(['start']);
  expect(MENU_LABEL).toEqual({ start: 'Fahren', profil: 'Profil' });
});

test('every item starts from a clean slate', () => {
  expect(open('start')).toEqual(HOME);
  expect(open('profil')).toEqual({ ...HOME, profile: true });
});

test('the active item follows what is on screen', () => {
  expect(activeItem(HOME)).toBe('start');
  expect(activeItem(open('profil'))).toBe('profil');
  expect(activeItem({ ...HOME, review: true })).toBe('profil');
  expect(activeItem({ ...HOME, health: 28 })).toBe('profil');
});

test('never during a ride: the ride screen stays exactly as it is', () => {
  expect(showMenu({ profile: true, riding: false, film: false, waiting: false })).toBe(true);
  expect(showMenu({ profile: true, riding: true, film: false, waiting: false })).toBe(false);
  expect(showMenu({ profile: false, riding: false, film: false, waiting: false })).toBe(false);
  expect(showMenu({ profile: true, riding: false, film: true, waiting: false })).toBe(false);
  expect(showMenu({ profile: true, riding: false, film: false, waiting: true })).toBe(false);
});
