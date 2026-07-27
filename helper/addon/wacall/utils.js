function substituteVariables(template, nodeParams) {
  if (typeof template !== "string") return template;

  console.log("Substituting variables in template:", template);
  console.log("Available nodeParams:", JSON.stringify(nodeParams, null, 2));

  const result = template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    try {
      const cleanPath = path.trim();
      console.log("Evaluating path:", cleanPath);

      const value = getValueByPath(nodeParams, cleanPath);
      console.log("Path result:", cleanPath, "=", value);

      return value !== undefined ? String(value) : match;
    } catch (error) {
      console.error(`Error substituting variable ${path}:`, error);
      return match;
    }
  });

  console.log("Substitution result:", result);
  return result;
}

function getValueByPath(obj, path) {
  if (!path || typeof path !== "string") return undefined;

  try {
    console.log(
      "Getting value by path:",
      path,
      "from object keys:",
      Object.keys(obj),
    );

    const keys = path.split(/\.|\[|\]/).filter(Boolean);
    console.log("Path keys:", keys);

    const result = keys.reduce((current, key) => {
      console.log("Current object:", current, "accessing key:", key);

      if (current === null || current === undefined) return undefined;

      if (!isNaN(key)) {
        const index = parseInt(key);
        return Array.isArray(current) ? current[index] : undefined;
      }

      return current[key];
    }, obj);

    console.log("Final result for path", path, ":", result);
    return result;
  } catch (error) {
    console.error(`Error evaluating path '${path}':`, error);
    return undefined;
  }
}

function evaluateCondition(value, condition) {
  if (!condition) return false;
  if (condition.type === "default") return true;

  const valueToCheck = condition.variable
    ? getValueByPath(value, condition.variable)
    : value;

  if (valueToCheck === undefined) return false;

  const conditionValue = condition.value;

  switch (condition.type) {
    case "equals":
      return String(valueToCheck) === String(conditionValue);
    case "contains":
      return String(valueToCheck).includes(String(conditionValue));
    case "startsWith":
      return String(valueToCheck).startsWith(String(conditionValue));
    case "endsWith":
      return String(valueToCheck).endsWith(String(conditionValue));
    case "greaterThan":
      return Number(valueToCheck) > Number(conditionValue);
    case "lessThan":
      return Number(valueToCheck) < Number(conditionValue);
    case "regex":
      try {
        const regex = new RegExp(conditionValue);
        return regex.test(String(valueToCheck));
      } catch (e) {
        console.error("Invalid regex:", e);
        return false;
      }
    default:
      return false;
  }
}

module.exports = {
  substituteVariables,
  getValueByPath,
  evaluateCondition,
};
