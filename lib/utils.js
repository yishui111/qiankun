"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Deferred = void 0;
exports.getContainer = getContainer;
exports.getContainerXPath = getContainerXPath;
exports.getDefaultTplWrapper = getDefaultTplWrapper;
exports.getWrapperId = getWrapperId;
exports.getXPathForElement = getXPathForElement;
exports.isBoundedFunction = isBoundedFunction;
exports.isCallable = void 0;
exports.isConstructable = isConstructable;
exports.isEnableScopedCSS = isEnableScopedCSS;
exports.nativeGlobal = void 0;
exports.nextTask = nextTask;
exports.performanceGetEntriesByName = performanceGetEntriesByName;
exports.performanceMark = performanceMark;
exports.performanceMeasure = performanceMeasure;
exports.sleep = sleep;
exports.toArray = toArray;
exports.validateExportLifecycle = validateExportLifecycle;

var _typeof2 = _interopRequireDefault(require("@babel/runtime/helpers/typeof"));

var _classCallCheck2 = _interopRequireDefault(require("@babel/runtime/helpers/classCallCheck"));

var _isFunction2 = _interopRequireDefault(require("lodash/isFunction"));

var _snakeCase2 = _interopRequireDefault(require("lodash/snakeCase"));

var _version = require("./version");

function toArray(array) {
  return Array.isArray(array) ? array : [array];
}

function sleep(ms) {
  return new Promise(function (resolve) {
    return setTimeout(resolve, ms);
  });
} // Promise.then might be synchronized in Zone.js context, we need to use setTimeout instead to mock next tick.


var nextTick = typeof window.Zone === 'function' ? setTimeout : function (cb) {
  return Promise.resolve().then(cb);
};
var globalTaskPending = false;
/**
 * Run a callback before next task executing, and the invocation is idempotent in every singular task
 * That means even we called nextTask multi times in one task, only the first callback will be pushed to nextTick to be invoked.
 * @param cb
 */

function nextTask(cb) {
  if (!globalTaskPending) {
    globalTaskPending = true;
    nextTick(function () {
      cb();
      globalTaskPending = false;
    });
  }
}

var fnRegexCheckCacheMap = new WeakMap();

function isConstructable(fn) {
  // prototype methods might be changed while code running, so we need check it every time
  var hasPrototypeMethods = fn.prototype && fn.prototype.constructor === fn && Object.getOwnPropertyNames(fn.prototype).length > 1;
  if (hasPrototypeMethods) return true;

  if (fnRegexCheckCacheMap.has(fn)) {
    return fnRegexCheckCacheMap.get(fn);
  }
  /*
    1. 有 prototype 并且 prototype 上有定义一系列非 constructor 属性
    2. 函数名大写开头
    3. class 函数
    满足其一则可认定为构造函数
   */


  var constructable = hasPrototypeMethods;

  if (!constructable) {
    // fn.toString has a significant performance overhead, if hasPrototypeMethods check not passed, we will check the function string with regex
    var fnString = fn.toString();
    var constructableFunctionRegex = /^function\b\s[A-Z].*/;
    var classRegex = /^class\b/;
    constructable = constructableFunctionRegex.test(fnString) || classRegex.test(fnString);
  }

  fnRegexCheckCacheMap.set(fn, constructable);
  return constructable;
}
/**
 * in safari
 * typeof document.all === 'undefined' // true
 * typeof document.all === 'function' // true
 * We need to discriminate safari for better performance
 */


var naughtySafari = typeof document.all === 'function' && typeof document.all === 'undefined';
var callableFnCacheMap = new WeakMap();

var isCallable = function isCallable(fn) {
  if (callableFnCacheMap.has(fn)) {
    return true;
  }

  var callable = naughtySafari ? typeof fn === 'function' && typeof fn !== 'undefined' : typeof fn === 'function';

  if (callable) {
    callableFnCacheMap.set(fn, callable);
  }

  return callable;
};

exports.isCallable = isCallable;
var boundedMap = new WeakMap();

function isBoundedFunction(fn) {
  if (boundedMap.has(fn)) {
    return boundedMap.get(fn);
  }
  /*
   indexOf is faster than startsWith
   see https://jsperf.com/string-startswith/72
   */


  var bounded = fn.name.indexOf('bound ') === 0 && !fn.hasOwnProperty('prototype');
  boundedMap.set(fn, bounded);
  return bounded;
}

function getDefaultTplWrapper(id, name) {
  return function (tpl) {
    return "<div id=\"".concat(getWrapperId(id), "\" data-name=\"").concat(name, "\" data-version=\"").concat(_version.version, "\">").concat(tpl, "</div>");
  };
}

function getWrapperId(id) {
  return "__qiankun_microapp_wrapper_for_".concat((0, _snakeCase2.default)(id), "__");
}

var nativeGlobal = new Function('return this')();
/** 校验子应用导出的 生命周期 对象是否正确 */

exports.nativeGlobal = nativeGlobal;

function validateExportLifecycle(exports) {
  var _ref = exports !== null && exports !== void 0 ? exports : {},
      bootstrap = _ref.bootstrap,
      mount = _ref.mount,
      unmount = _ref.unmount;

  return (0, _isFunction2.default)(bootstrap) && (0, _isFunction2.default)(mount) && (0, _isFunction2.default)(unmount);
}

var Deferred = function Deferred() {
  var _this = this;

  (0, _classCallCheck2.default)(this, Deferred);
  this.promise = new Promise(function (resolve, reject) {
    _this.resolve = resolve;
    _this.reject = reject;
  });
};

exports.Deferred = Deferred;
var supportsUserTiming = typeof performance !== 'undefined' && typeof performance.mark === 'function' && typeof performance.clearMarks === 'function' && typeof performance.measure === 'function' && typeof performance.clearMeasures === 'function' && typeof performance.getEntriesByName === 'function';

function performanceGetEntriesByName(markName, type) {
  var marks = null;

  if (supportsUserTiming) {
    marks = performance.getEntriesByName(markName, type);
  }

  return marks;
}

function performanceMark(markName) {
  if (supportsUserTiming) {
    performance.mark(markName);
  }
}

function performanceMeasure(measureName, markName) {
  if (supportsUserTiming && performance.getEntriesByName(markName, 'mark').length) {
    performance.measure(measureName, markName);
    performance.clearMarks(markName);
    performance.clearMeasures(measureName);
  }
}

function isEnableScopedCSS(sandbox) {
  if ((0, _typeof2.default)(sandbox) !== 'object') {
    return false;
  }

  if (sandbox.strictStyleIsolation) {
    return false;
  }

  return !!sandbox.experimentalStyleIsolation;
}
/**
 * copy from https://developer.mozilla.org/zh-CN/docs/Using_XPath
 * @param el
 * @param document
 */


function getXPathForElement(el, document) {
  // not support that if el not existed in document yet(such as it not append to document before it mounted)
  if (!document.body.contains(el)) {
    return undefined;
  }

  var xpath = '';
  var pos;
  var tmpEle;
  var element = el;

  while (element !== document.documentElement) {
    pos = 0;
    tmpEle = element;

    while (tmpEle) {
      if (tmpEle.nodeType === 1 && tmpEle.nodeName === element.nodeName) {
        // If it is ELEMENT_NODE of the same name
        pos += 1;
      }

      tmpEle = tmpEle.previousSibling;
    }

    xpath = "*[name()='".concat(element.nodeName, "'][").concat(pos, "]/").concat(xpath);
    element = element.parentNode;
  }

  xpath = "/*[name()='".concat(document.documentElement.nodeName, "']/").concat(xpath);
  xpath = xpath.replace(/\/$/, '');
  return xpath;
}

function getContainer(container) {
  return typeof container === 'string' ? document.querySelector(container) : container;
}

function getContainerXPath(container) {
  if (container) {
    var containerElement = getContainer(container);

    if (containerElement) {
      return getXPathForElement(containerElement, document);
    }
  }

  return undefined;
}