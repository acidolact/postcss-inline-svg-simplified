import postcss from 'postcss';
import { parseRuleDefinition, getRuleParams } from './parseRule.js';
import { parseDeclValue } from './parseDecl.js';
import resolveId from './resolveId.js';
import load from './load.js';

function removeLoader(loader) {
    if (!loader.error && loader.node.type === 'atrule') {
        loader.node.remove();
    }
}

function applyInliner(inliner) {
    if (!inliner.loader.error) {
        inliner.valueNode.value = 'url';
        inliner.valueNode.nodes = [{
            type: 'word',
            value: inliner.loader.svg
        }];
    }
}

function stringifyInliner(inliner) {
    if (!inliner.loader.error) {
        inliner.node.value = String(inliner.parsedValue);
    }
}

export default postcss.plugin('postcss-inline-svg', (opts = {}) => (css, result) => {
    const loadersMap = {};
    const loaders = [];
    const inliners = [];

    css.walk(node => {
        if (node.type === 'atrule') {
            if (node.name === 'svg-load') {
                try {
                    const file = node.source && node.source.input && node.source.input.file;
                    const { name, url } = parseRuleDefinition(node.params);
                    const { params, selectors } = getRuleParams(node);
                    const loader = {
                        id: resolveId(file, url, opts),
                        parent: file,
                        params,
                        selectors,
                        node,
                        styleString
                    };
                    loaders.push(loader);
                    loadersMap[name] = loader;
                } catch (e) {
                    node.warn(result, e.message);
                }
            }
        } else if (node.type === 'decl') {
            let val = node.value;
            if (Math.max( val.indexOf('svg-load('), val.indexOf('svg-inline('), val.indexOf('svg-inline-with-styles(') ) >= 0 ) {
                try {
                    const file = node.source && node.source.input && node.source.input.file;
                    const statements = parseDeclValue(node.value);
                    statements.loaders.forEach(({ url, params, valueNode, parsedValue, selectors, styleString }) => {
                        const loader = {
                            id: resolveId(file, url, opts),
                            parent: file,
                            params,
                            selectors: selectors || {},
                            node,
                            styleString
                        };
                        loaders.push(loader);
                        inliners.push({
                            loader,
                            node,
                            valueNode,
                            parsedValue
                        });
                    });
                    statements.inliners.forEach(({ name, valueNode, parsedValue }) => {
                        const loader = loadersMap[name];
                        if (loader) {
                            inliners.push({
                                loader,
                                node,
                                valueNode,
                                parsedValue
                            });
                        } else {
                            node.warn(result, `"${name}" svg is not defined`);
                        }
                    });
                } catch (e) {
                    node.warn(result, e.message);
                }
            }
        }
    });

    const promises = loaders.map(loader => {
        return load(loader.id, loader.params, loader.selectors, opts, loader.styleString).then(code => {
            loader.svg = code;
            result.messages.push({
                type: 'dependency',
                file: loader.id,
                parent: loader.parent
            });
        }).catch(err => {
            loader.error = true;
            loader.node.warn(result, err.message);
        });
    });

    return Promise.all(promises).then(() => {
        loaders.forEach(removeLoader);
        inliners.forEach(applyInliner);
        inliners.forEach(stringifyInliner);
    });
});
