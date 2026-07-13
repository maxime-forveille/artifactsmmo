/**
 * What a character should be doing. `farm`, `hunt`, and `autoHunt` run
 * forever; `craftAndEquip` works through `items` in order, then stops;
 * `craftAndEquipThenHunt` does the same craftAndEquip pass (a no-op for
 * items already equipped) and then switches to hunting forever - the
 * "get geared up, then go fight" combo. `autoHunt` is like `hunt`, but
 * re-picks the monster before every cycle instead of using a fixed one
 * (see `findNextSafeMonster`), so a character naturally moves to a better
 * target as it levels up. New task types should be added here first, then
 * handled in `runTask`'s switch (the `never` check there makes an
 * unhandled case a compile error rather than a silent no-op).
 */
export type Task =
  | { readonly type: "autoHunt" }
  | { readonly type: "craftAndEquip"; readonly items: readonly string[] }
  | {
      readonly type: "craftAndEquipThenHunt";
      readonly items: readonly string[];
      readonly monster: string;
    }
  | { readonly type: "farm"; readonly resource: string }
  | { readonly type: "hunt"; readonly monster: string };
