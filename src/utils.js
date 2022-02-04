import hoistStatics from 'hoist-non-react-statics';
import warning from 'warning';
import { isMemo } from 'react-is';

function getDisplayName(WrappedComponent) {
  return WrappedComponent.displayName || WrappedComponent.name || 'WrappedComponent';
}

export function argumentContainer(Container, WrappedComponent) {
  /* eslint no-param-reassign:0 */
  Container.displayName = `Form(${getDisplayName(WrappedComponent)})`;
  Container.WrappedComponent = WrappedComponent;
  return hoistStatics(Container, WrappedComponent);
}

export function identity(obj) {
  return obj;
}

/**
 * 压平数组
 * // tag: 这个concat压平二维数组可以借鉴下 ([a, b, [[c, d], e]]) => [a, b, [c, d], e]
 * // todo: 原理后续看下
 * @notes yzs
 * @param {Array} arr 
 * @returns {Array}
 */
export function flattenArray(arr) {
  return Array.prototype.concat.apply([], arr);
}

/**
 * @description 遍历树
 * @notes yzs
 * @param {Sting | undefined} path 
 * @param {Object | Array} tree 字段
 * @param {Function} isLeafNode 判断是否是叶子节点的func
 * @param {String} errorMessage 报错信息
 * @param {Function} callback 回调
 * @returns void
 */
export function treeTraverse(path = '', tree, isLeafNode, errorMessage, callback) {
  if (isLeafNode(path, tree)) {
    callback(path, tree);
  } else if (tree === undefined || tree === null) {
    // Do nothing
  } else if (Array.isArray(tree)) {
    tree.forEach((subTree, index) => treeTraverse(
      `${path}[${index}]`,
      subTree,
      isLeafNode,
      errorMessage,
      callback
    ));
  } else { // It's object and not a leaf node
    if (typeof tree !== 'object') {
      warning(false, errorMessage);
      return;
    }
    Object.keys(tree).forEach(subTreeKey => {
      const subTree = tree[subTreeKey];
      treeTraverse(
        `${path}${path ? '.' : ''}${subTreeKey}`,
        subTree,
        isLeafNode,
        errorMessage,
        callback
      );
    });
  }
}

/**
 * @author yzsexe
 * @description 压平字段
 * @param {Object | Array} maybeNestedFields 可能是嵌套层级的字段
 * @param {Function} isLeafNode 判断是否是叶子节点的func
 * @param {String} errorMessage 报错信息
 * @returns 
 */
export function flattenFields(maybeNestedFields, isLeafNode, errorMessage) {
  const fields = {};
  treeTraverse(undefined, maybeNestedFields, isLeafNode, errorMessage, (path, node) => {
    fields[path] = node;
  });
  return fields;
}

/**
 * 输出标准化的校验规则
 * @notes yzsexe
 * @param {Array< { validator: function(rule, value, callback) } 
 * | { trigger: string | string[]; rules: Array<{type?: string; required?: string; message?: string }> }
 * >} validate 
 * @param {Array< { validator: function(rule, value, callback) } 
 * | { trigger: string | string[]; rules: Array<{type?: string; required?: string; message?: string }> }
 * >} rules 
 * @param {string | string[]} validateTrigger 
 * @returns {Array< { trigger: string | string[]; validator: function(rule, value, callback) } 
 * | { trigger: string | string[]; rules: Array<{type?: string; required?: string; message?: string }> }
 * >} { trigger: string[], rules: todoAny[], ...rest }
 */
export function normalizeValidateRules(validate, rules, validateTrigger) {
  const validateRules = validate.map((item) => {
    const newItem = {
      ...item,
      trigger: item.trigger || [],
    };
    if (typeof newItem.trigger === 'string') {
      newItem.trigger = [newItem.trigger];
    }
    return newItem;
  });
  if (rules) {
    validateRules.push({
      trigger: validateTrigger ? [].concat(validateTrigger) : [],
      rules,
    });
  }
  return validateRules;
}

/**
 * 获取有配置rules规则的字段的触发方式数组
 * @notes yzsexe
 * @param {Array} validateRules 
 * @returns {Array} string[]
 */
export function getValidateTriggers(validateRules) {
  return validateRules
    .filter(item => !!item.rules && item.rules.length)
    .map(item => item.trigger)
    .reduce((pre, curr) => pre.concat(curr), []);
}

/**
 * 指定如何从事件中获取值
 * @notes yzs
 * @param {*} e 
 * @returns 
 */
export function getValueFromEvent(e) {
  // To support custom element
  if (!e || !e.target) {
    return e;
  }
  const { target } = e;
  return target.type === 'checkbox' ? target.checked : target.value;
}

export function getErrorStrs(errors) {
  if (errors) {
    return errors.map((e) => {
      if (e && e.message) {
        return e.message;
      }
      return e;
    });
  }
  return errors;
}

export function getParams(ns, opt, cb) {
  let names = ns;
  let options = opt;
  let callback = cb;
  if (cb === undefined) {
    if (typeof names === 'function') {
      callback = names;
      options = {};
      names = undefined;
    } else if (Array.isArray(names)) {
      if (typeof options === 'function') {
        callback = options;
        options = {};
      } else {
        options = options || {};
      }
    } else {
      callback = options;
      options = names || {};
      names = undefined;
    }
  }
  return {
    names,
    options,
    callback,
  };
}

export function isEmptyObject(obj) {
  return Object.keys(obj).length === 0;
}

/**
 * 判断有无设置校验规则
 * @param {*} validate 
 * @returns 
 */
export function hasRules(validate) {
  if (validate) {
    return validate.some((item) => {
      return item.rules && item.rules.length;
    });
  }
  return false;
}

export function startsWith(str, prefix) {
  return str.lastIndexOf(prefix, 0) === 0;
}

export function supportRef(nodeOrComponent) {
  const type = isMemo(nodeOrComponent)
    ? nodeOrComponent.type.type
    : nodeOrComponent.type;

  // Function component node
  if (typeof type === 'function' && !(type.prototype && type.prototype.render)) {
    return false;
  }

  // Class component
  if (
    typeof nodeOrComponent === 'function' &&
    !(nodeOrComponent.prototype && nodeOrComponent.prototype.render)
  ) {
    return false;
  }

  return true;
}
