import { suspend } from 'suspend-react';
import { Pokemon, PokemonList } from './components';

declare const IS_CLIENT: boolean | undefined;
export default function List({ DB }: { DB?: D1Database }) {
  const results = suspend(async () => {
    if (typeof window !== 'undefined') {
      // @ts-expect-error we've inlined the data in the component
      return window.__data;
    }

    if (!DB) {
      throw new Error('DB is not defined');
    }

    if (IS_CLIENT) {
      throw new Error("Shouldn't reach this code on the client");
    }

    const { results } = await DB.prepare(
      'SELECT * FROM pokemon ORDER BY RANDOM() LIMIT 12',
    ).all();

    const result = {
      rows: results,
    };

    return result;
  }, ['pokemon' + new Date().getSeconds() * 4]) as {
    rows: {
      id: number;
      name: string;
    }[];
  };

  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: `
        window.__data = ${JSON.stringify(results)};
        `,
        }}
      />
      <PokemonList>
        {results.rows.map((p) => (
          <Pokemon key={p.id} id={p.id} name={p.name} />
        ))}
      </PokemonList>
    </>
  );
}
