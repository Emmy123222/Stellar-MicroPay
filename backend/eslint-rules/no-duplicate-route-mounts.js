/**
 * ESLint custom rule to detect duplicate app.use() route mounts
 *
 * This rule prevents mounting the same route path with the same handler
 * multiple times, which can cause unexpected behavior and performance issues.
 */

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow duplicate Express route mounts",
      category: "Best Practices",
      recommended: true,
    },
    messages: {
      duplicateMount: "Duplicate route mount detected: '{{path}}' with handler '{{handler}}' is already mounted at line {{line}}",
    },
    schema: [],
  },

  create(context) {
    // Track route mounts: Map<"path::handler", lineNumber>
    const routeMounts = new Map();

    return {
      CallExpression(node) {
        // Check if this is an app.use() call
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.name === "app" &&
          node.callee.property.name === "use" &&
          node.arguments.length >= 2
        ) {
          const firstArg = node.arguments[0];
          const secondArg = node.arguments[1];

          // Check if first arg is a string literal (route path)
          if (firstArg.type === "Literal" && typeof firstArg.value === "string") {
            const routePath = firstArg.value;

            // Check if second arg is an identifier (route handler)
            if (secondArg.type === "Identifier") {
              const handlerName = secondArg.name;
              const key = `${routePath}::${handlerName}`;

              // Check for duplicate
              if (routeMounts.has(key)) {
                const firstLine = routeMounts.get(key);
                context.report({
                  node: secondArg,
                  messageId: "duplicateMount",
                  data: {
                    path: routePath,
                    handler: handlerName,
                    line: firstLine,
                  },
                });
              } else {
                // Record this mount
                routeMounts.set(key, node.loc.start.line);
              }
            }
          }
        }
      },
    };
  },
};
