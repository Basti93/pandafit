# Final fix report (Dojo 4)

All 12 findings fixed. Data writes unchanged (deleteRecipe moved word for word into useMealData).
- 1: EssenPage follows scroll with a passive listener (ignored while hidden), restores in requestAnimationFrame. Test fires scroll events and clamps scrollY after hiding.
- 2: deleteRecipe in useMealData, recipeCtx.deleteOwn. New test in meal-page.test.tsx.
- 3: Essen start stays mounted in KeptPage (shared hook with EssenPage). New focus test in essen-start.test.tsx.
- 4: tokens --day, --seg-on, --seg-on-screen removed; --slot dropped from LOCAL.
- 5: copy in meals-view.ts (MEAL_GONE, ALREADY_COOKED, NO_PLAN, WISH_SENT, placePrompt). Wunsch text: "Dein Wunsch ist bei Bo angekommen."
- 6: recipeImageUrl in MealImage.tsx. 7: weekAt helper. 8: QUIET shared. 9: ausdauer icon. 10: dead sheet removed. 11: PlaceCard default per render until chosen. 12: goBike?.() / goRun?.().
- essen.test.tsx Nudeln check now by checkbox role (hidden start page also holds the text).

Checks: typecheck 0; lint 0 errors, 51 warnings; test:web-smoke passed; npm test full: 316 files, 3785 tests pass with --maxWorkers=4. With default workers (machine load ~20) a few unrelated timing-based tests failed differently on each run and passed alone.
