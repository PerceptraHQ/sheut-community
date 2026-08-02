export default {
  "*.{js,jsx,ts,tsx,json,jsonc,css}": "biome check --write --no-errors-on-unmatched",
  "src/**/*.{ts,tsx}": "eslint --fix",
  "*.rs": "rustfmt --edition 2024",
};
