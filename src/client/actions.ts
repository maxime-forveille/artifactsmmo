import type { components } from './schema.js';
import { toResult, type ArtifactsTransport } from './transport.js';

type ActionDependencies = Readonly<{
  clearBankItems: () => void;
  client: ArtifactsTransport;
}>;

/** Builds elementary Artifacts MMO Action calls. */
export const createActionOperations = ({
  clearBankItems,
  client,
}: ActionDependencies) => {
  const moveCharacter = (
    name: string,
    destination: components['schemas']['DestinationSchema'],
  ) =>
    toResult(
      client.POST('/my/{name}/action/move', {
        body: destination,
        params: { path: { name } },
      }),
    );

  const rest = (name: string) =>
    toResult(
      client.POST('/my/{name}/action/rest', { params: { path: { name } } }),
    );

  const gather = (name: string) =>
    toResult(
      client.POST('/my/{name}/action/gathering', {
        params: { path: { name } },
      }),
    );

  const fight = (name: string, participants?: readonly string[]) =>
    toResult(
      client.POST('/my/{name}/action/fight', {
        body: participants ? { participants: [...participants] } : undefined,
        params: { path: { name } },
      }),
    );

  const craft = (name: string, code: string, quantity = 1) =>
    toResult(
      client.POST('/my/{name}/action/crafting', {
        body: { code, quantity },
        params: { path: { name } },
      }),
    );

  const equip = (name: string, items: components['schemas']['EquipSchema'][]) =>
    toResult(
      client.POST('/my/{name}/action/equip', {
        body: items,
        params: { path: { name } },
      }),
    );

  const unequip = (
    name: string,
    items: components['schemas']['UnequipSchema'][],
  ) =>
    toResult(
      client.POST('/my/{name}/action/unequip', {
        body: items,
        params: { path: { name } },
      }),
    );

  const giveItems = (
    name: string,
    receiverCharacter: string,
    items: components['schemas']['SimpleItemSchema'][],
  ) =>
    toResult(
      client.POST('/my/{name}/action/give/item', {
        body: { character: receiverCharacter, items },
        params: { path: { name } },
      }),
    );

  const depositItems = (
    name: string,
    items: components['schemas']['SimpleItemSchema'][],
  ) =>
    toResult(
      client.POST('/my/{name}/action/bank/deposit/item', {
        body: items,
        params: { path: { name } },
      }),
    ).map((response) => {
      clearBankItems();
      return response;
    });

  const withdrawItems = (
    name: string,
    items: components['schemas']['SimpleItemSchema'][],
  ) =>
    toResult(
      client.POST('/my/{name}/action/bank/withdraw/item', {
        body: items,
        params: { path: { name } },
      }),
    ).map((response) => {
      clearBankItems();
      return response;
    });

  const depositGold = (name: string, quantity: number) =>
    toResult(
      client.POST('/my/{name}/action/bank/deposit/gold', {
        body: { quantity },
        params: { path: { name } },
      }),
    );

  const withdrawGold = (name: string, quantity: number) =>
    toResult(
      client.POST('/my/{name}/action/bank/withdraw/gold', {
        body: { quantity },
        params: { path: { name } },
      }),
    );

  return {
    craft,
    depositGold,
    depositItems,
    equip,
    fight,
    gather,
    giveItems,
    moveCharacter,
    rest,
    unequip,
    withdrawGold,
    withdrawItems,
  };
};
