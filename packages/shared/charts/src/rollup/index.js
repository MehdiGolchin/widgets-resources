const { join } = require("path");
const replace = require("rollup-plugin-re");
const { nodeResolve } = require("@rollup/plugin-node-resolve");
const { getBabelInputPlugin, getBabelOutputPlugin } = require("@rollup/plugin-babel");
const commonjs = require("@rollup/plugin-commonjs");
const { terser } = require("rollup-plugin-terser");
const command = require("rollup-plugin-command");
const { cp } = require("shelljs");

function sharedChardConfig(args, chartName) {
    const production = Boolean(args.configProduction);
    const outDir = join(process.cwd(), "dist/tmp/widgets/com/mendix/shared");
    const result = args.configDefaultConfig;
    const [jsConfig, mJsConfig] = result;

    // We define the new library externals for the entry points
    const libraryExternals = [
        /^react-plotly\.js($|\/)/,
        /(^|\/)shared\/plotly.js$/,
        /^react-ace($|\/)/,
        /(^|\/)shared\/ace.js$/
    ];

    // We force the original configuration to replace the library with the local implementation
    // Configuration for the main entry point for the client
    replaceReactPlotlyBeforeZipping(jsConfig);
    // Configuration for Modern Client (mJS)
    replaceReactPlotlyBeforeZipping(mJsConfig);

    const externals = jsConfig.external;

    // We force the externals to contain the library + the just built api file
    jsConfig.external = [...externals, ...libraryExternals];
    mJsConfig.external = [...externals, ...libraryExternals];

    const plugins = [
        nodeResolve({ preferBuiltins: false, mainFields: ["module", "browser", "main"] }),
        getBabelInputPlugin({
            sourceMaps: false,
            babelrc: false,
            babelHelpers: "bundled",
            plugins: ["@babel/plugin-proposal-class-properties"],
            overrides: [
                {
                    plugins: ["@babel/plugin-transform-flow-strip-types", "@babel/plugin-transform-react-jsx"]
                }
            ]
        }),
        commonjs({
            extensions: [".js", ".jsx", ".tsx", ".ts"],
            transformMixedEsModules: true,
            requireReturnsDefault: "auto",
            ignore: id => externals.some(value => new RegExp(value).test(id))
        }),
        getBabelOutputPlugin({
            sourceMaps: false,
            babelrc: false,
            compact: false,
            presets: [["@babel/preset-env", { targets: { safari: "12" } }]],
            allowAllFormats: true
        }),
        replace({
            patterns: [
                {
                    test: "process.env.NODE_ENV",
                    replace: production ? "'production'" : "'development'"
                }
            ]
        }),
        production ? terser() : null,
        command([
            () => {
                const workerFilePath = join(
                    process.cwd(),
                    `../../../node_modules/ace-builds/src-min-noconflict/worker-json.js`
                );
                cp(workerFilePath, outDir);
            }
        ])
    ];
    // We add the library bundling (ES output) as the first item for rollup
    result.unshift(
        {
            input: require.resolve("react-plotly.js"),
            output: {
                format: "amd",
                file: join(outDir, "plotly.js"),
                sourcemap: false
            },
            external: externals,
            plugins
        },
        {
            input: require.resolve("react-ace"),
            output: {
                format: "amd",
                file: join(outDir, "ace.js"),
                sourcemap: false
            },
            external: externals,
            plugins
        }
    );

    // We change the output because chart widget packages were wrongly named with uppercase first letter in the past.
    jsConfig.output.file = join(
        process.cwd(),
        `dist/tmp/widgets/com/mendix/widget/custom/${chartName}/${chartName}.js`
    );
    mJsConfig.output.file = join(
        process.cwd(),
        `dist/tmp/widgets/com/mendix/widget/custom/${chartName}/${chartName}.mjs`
    );

    result.forEach(config => {
        const onwarn = config.onwarn;
        if (onwarn) {
            config.onwarn = warning => {
                // The library itself throws a lot of esm module related errors on compilation.
                // For now they don't seem related to us and everything still works, so I ignored them.
                if (
                    warning.loc &&
                    (warning.loc.file.includes("fast-json-patch") || warning.loc.file.includes("shared/charts")) &&
                    warning.code === "THIS_IS_UNDEFINED"
                ) {
                    return;
                }
                onwarn(warning);
            };
        }
    });
    return result;
}

function replaceReactPlotlyBeforeZipping(config) {
    config.plugins.splice(
        -1,
        0,
        replace({
            replaces: {
                "react-plotly.js": "../../../../shared/plotly.js",
                "react-ace": "../../../../../shared/ace.js"
            }
        })
    );
}

module.exports = {
    sharedChardConfig
};
