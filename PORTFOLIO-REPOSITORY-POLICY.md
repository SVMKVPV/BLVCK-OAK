# Portfolio repository policy

BLVCK OAK portfolio and marketplace websites must be maintained as independent GitHub repositories.

## Rule for future changes

Once a site has `repoStatus: "active"` in `portfolio-repositories.json`:

1. Edit that site's dedicated repository.
2. Deploy that repository to its own Netlify project.
3. Keep the public preview URL in the BLVCK OAK marketplace/portfolio catalogue.
4. Do not edit the old copy in `BLVCK-OAK/previews`.
5. The main `BLVCK-OAK` repository should only own catalogue metadata, navigation, marketplace UI and links to the independent sites.

## Existing independent repositories

- Cafe Cicheti & Co → `SVMKVPV/cafe`
- Anand Motors → `SVMKVPV/motors`
- TablePulse → `SVMKVPV/blvckoak-portfolio-tablepulse` (private source, public deployment)
- Aurora Cafe → `SVMKVPV/blvckoak-portfolio-aurora-cafe` (private source, public deployment)

These should be treated as the authoritative source for future changes to those websites.

TablePulse and Aurora Cafe keep lightweight preview wrappers in `BLVCK-OAK/previews` so existing catalogue routes and access controls continue to work. Their complete website code and assets live only in the independent repositories. The registry records both the catalogue `currentPreview` route and the independent `deploymentUrl`.

## Repositories still to create

The remaining entries in `portfolio-repositories.json` use `repoStatus: "needs_creation"` and have a reserved `targetRepo` name.

The GitHub connector used for this migration can write files, branches and pull requests but does not expose account-level repository creation. Do not mark an entry active until the repository actually exists and contains a self-contained build.

## Migration standard for each site

A migrated site should contain everything it needs to run without depending on private files inside `BLVCK-OAK`:

- `index.html`
- its own CSS
- its own JavaScript
- images/assets used by that site
- `README.md`
- `netlify.toml` when needed
- any serverless functions required by the individual site

For legacy previews that currently share `previews/preview.css` and `previews/preview.js`, copy the required shared code into the new repository during migration so future changes cannot unintentionally affect other portfolio sites.

## Naming

New portfolio repositories use:

`SVMKVPV/blvckoak-portfolio-<site-name>`

The two already-existing repositories keep their current names unless explicitly renamed later.
