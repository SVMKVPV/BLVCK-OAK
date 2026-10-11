# Community photography

The 100 fictional AI showcase profiles use photorealistic images generated with the built-in image-generation tool. These images are illustrative concepts, not photographs of real businesses, customers, premises or purchasable inventory.

Each profile has its own photograph, used in the discovery feed, storefront hero and sample-offering cards. Offering cards reuse the profile's collection imagery; they are not individual verified product photographs.

Production assets are self-hosted in `community/photos/`: a 1200-pixel WebP and a 600-pixel thumbnail per profile. The build copies them to the public `community/photos/` path. Responsive discovery images are lazy-loaded. Do not replace missing imagery with abstract shapes or unrelated stock images.

The generation prompt manifest is recorded in `community/image-prompts.json`. Profile names, routes and existing save/follow behaviour are unchanged by this imagery update.
