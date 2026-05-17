# Printify blueprints & variants

Mapping configurado en [src/publisher/blueprint-map.ts](../src/publisher/blueprint-map.ts).

## Estado actual (verificado contra la API de Printify)

| ProductType | Blueprint ID | Blueprint | Provider ID | Provider | Variants | Print position |
|---|---|---|---|---|---|---|
| `tshirt` | 5 | Unisex Jersey Short Sleeve Tee (Bella+Canvas 3001) | 29 | Monster Digital | 17643–17647 (Solid White S–2XL) | `front` |
| `mug` | 68 | Mug 11oz | 1 | SPOKE Custom Products | 33719 (11oz) | `front` |
| `poster` | 282 | Matte Vertical Posters | 2 | Sensaria | 43135 / 43138 / 43141 / 43144 (11×14 / 12×18 / 16×20 / 18×24) | `front` |

## Cómo refrescar IDs

Printify cambia su catálogo sin aviso. Cuando el publisher devuelva error `8251` ("Variants do not match selected blueprint and print provider"), hay que sacar IDs reales de la API.

### 1. Listar blueprints (buscar por título)

```bash
node --input-type=module -e "
import('dotenv/config').then(async () => {
  const r = await fetch('https://api.printify.com/v1/catalog/blueprints.json', {
    headers: { Authorization: 'Bearer ' + process.env.PRINTIFY_API_TOKEN },
  });
  const d = await r.json();
  d.filter(b => /mug/i.test(b.title)).forEach(b => console.log(b.id, '|', b.title, '|', b.brand));
});
"
```

Cambia el regex (`/mug/i`, `/poster/i`, `/tee|t-shirt/i`) según busques.

### 2. Listar providers de un blueprint

```bash
BP=68
node --input-type=module -e "
import('dotenv/config').then(async () => {
  const r = await fetch('https://api.printify.com/v1/catalog/blueprints/$BP/print_providers.json', {
    headers: { Authorization: 'Bearer ' + process.env.PRINTIFY_API_TOKEN },
  });
  (await r.json()).forEach(p => console.log(p.id, '|', p.title));
});
"
```

### 3. Listar variants de un blueprint + provider

```bash
BP=5
PP=29
node --input-type=module -e "
import('dotenv/config').then(async () => {
  const r = await fetch('https://api.printify.com/v1/catalog/blueprints/$BP/print_providers/$PP/variants.json', {
    headers: { Authorization: 'Bearer ' + process.env.PRINTIFY_API_TOKEN },
  });
  const d = await r.json();
  // Filtra por color/talla a gusto
  d.variants
    .filter(v => v.options.color === 'Solid White' && ['S','M','L','XL','2XL'].includes(v.options.size))
    .forEach(v => console.log(v.id, '|', v.title));
});
"
```

### 4. Actualizar `src/publisher/blueprint-map.ts`

Pega los IDs reales en el bloque correspondiente. Mantén la tabla de arriba sincronizada cuando cambies algo.

## Criterios al elegir variantes

- **Tshirt**: empezar con un solo color (Solid White) y sizes S–2XL. Etsy castiga listings con muchas variantes vacías de stock.
- **Mug**: el provider SPOKE solo da 11oz blanca. Si quieres 15oz o negras, usa blueprint 478 (Ceramic Mug 11/15oz) o 479 (Black Mug).
- **Poster**: Sensaria tiene 46 tamaños (matte). Para Etsy 4 tamaños populares es lo razonable (11×14 / 12×18 / 16×20 / 18×24).

## Errores comunes

| Código Printify | Significado | Acción |
|---|---|---|
| `8251` | Variants do not match selected blueprint and print provider | Refresca IDs siguiendo los pasos arriba |
| `8252` | Print area placeholder mismatch | El `printPosition` no existe en este blueprint — comprueba `placeholders[].position` de cualquier variante |
| `400` sin código claro | Provider no disponible para esta blueprint | Comprueba con paso 2 que el `printProviderId` está en la lista de providers del blueprint |
