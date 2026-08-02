export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "body-empty": [2, "never"],
    "body-leading-blank": [2, "always"],
    "body-max-line-length": [2, "always", 100],
    "body-min-length": [2, "always", 40],
    "header-max-length": [2, "always", 100],
    "subject-min-length": [2, "always", 10],
  },
};
