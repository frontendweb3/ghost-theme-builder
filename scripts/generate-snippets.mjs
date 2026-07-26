// Generates dynamic VS Code snippets based on package.json config (image_sizes, custom settings)
// Usage: node snippets/generate-snippets.mjs

import fs from "node:fs";
import path from "node:path";

const alt = `alt="\${5|{{title}},{{@site.title}},{{name}},{{#if feature_image_alt}}{{feature_image_alt}}{{else}}{{title}}{{/if}}|}"`;

function sizeMaker(keys, image_sizes, type = null) {
  const format = !type ? "" : type === "avif" ? ' format="avif"' : ' format="webp"';

  return keys
    .reduce((previous, current) => {
      previous.push({ name: current, width: image_sizes[current].width });
      return previous;
    }, [])
    .sort((a, b) => (a.width > b.width ? 1 : a.width < b.width ? -1 : 0))
    .map(
      (size, idx, arr) =>
        arr.length === idx + 1
          ? `\n\t{{img_url \${1|feature_image,@site.cover_image,cover_image,profile_image|} size="${size.name}"${format}}} ${size.width}w`
          : `\n\t{{img_url \${1|feature_image,@site.cover_image,cover_image,profile_image|} size="${size.name}"${format}}} ${size.width}w,`,
    )
    .join("");
}

function imageHelper(image_sizes) {
  const keys = Object.keys(image_sizes);
  return {
    sizeNames: keys.join(),
    sizes: sizeMaker(keys, image_sizes),
    avif: sizeMaker(keys, image_sizes, "avif"),
    webp: sizeMaker(keys, image_sizes, "webp"),
  };
}

function responsiveImageTemplate(sizes, sizeNames) {
  return `<img
    srcset="${sizes}"
    sizes="$2"
    src="{{img_url \${1|feature_image,@site.cover_image,cover_image,profile_image|} size="\${3|${sizeNames}|}"}}"
    class="$4"
    ${alt}
/>`;
}

function responsiveImageTemplateWithFormats(avif, webp, sizes, sizeNames) {
  return `<picture>
  <source 
    srcset="${avif}"
    sizes="$2" 
    type="image/avif"
  >
  <source 
    srcset="${webp}"
    sizes="$2" 
    type="image/webp"
  >
  <img
    srcset="${sizes}"
    sizes="$2" 
    src="{{img_url \${1|feature_image,@site.cover_image,cover_image,profile_image|} size="\${3|${sizeNames}|}"}}"
    class="$4"
    ${alt}
  >
</picture>`;
}

function createResponsiveImageHelper(image_sizes) {
  const { sizes, sizeNames } = imageHelper(image_sizes);
  return {
    name: "img:responsive",
    snippet: responsiveImageTemplate(sizes, sizeNames),
    definition: "Generate responsive images based on your theme configuration",
  };
}

function createResponsiveImageHelperWithFormats(image_sizes) {
  const { sizes, sizeNames, avif, webp } = imageHelper(image_sizes);
  return {
    name: "img:formats",
    snippet: responsiveImageTemplateWithFormats(avif, webp, sizes, sizeNames),
    definition:
      "Generate next-gen format, responsive images based on your theme configuration",
  };
}

function createCustomConfigHelper(custom) {
  const keys = Object.keys(custom).join();
  return {
    name: "custom",
    snippet: `@custom.\${1|${keys}|} $2`,
    definition: "Fetch custom values",
  };
}

export function generateSnippets(packageJsonPath) {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  const { image_sizes, custom } = pkg.config || {};
  const snippets = [];

  if (custom) {
    snippets.push(createCustomConfigHelper(custom));
  }

  if (image_sizes) {
    snippets.push(createResponsiveImageHelper(image_sizes));
    snippets.push(createResponsiveImageHelperWithFormats(image_sizes));
  }

  return snippets;
}

// Run directly: node snippets/generate-snippets.mjs
if (process.argv[1] === import.meta.url) {
  const cwd = process.cwd();
  const pkgPath = path.join(cwd, "package.json");

  if (!fs.existsSync(pkgPath)) {
    console.error("No package.json found in current directory");
    process.exit(1);
  }

  const snippets = generateSnippets(pkgPath);
  console.log(JSON.stringify(snippets, null, 2));
}
