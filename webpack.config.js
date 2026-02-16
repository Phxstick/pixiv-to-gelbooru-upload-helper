import path from "path"
import CopyWebpackPlugin from "copy-webpack-plugin"
import ForkTsCheckerWebpackPlugin from "fork-ts-checker-webpack-plugin";
import { CleanWebpackPlugin } from "clean-webpack-plugin";
import { fileURLToPath } from "url";
import webpack from "webpack";
import manifest from "./manifest.json" assert { type: "json" };
const { DefinePlugin } = webpack

export default ((_, argv) => {
    const production = argv.mode === "production"
    const releaseName = `${manifest.name}-${manifest.version}`
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)
    return {
        mode: "development",
        // Without this, webpack uses "eval" which is not allowed in an extension
        devtool: 'cheap-module-source-map',
        entry: {
            background: "./src/js/pages/background.ts",
            settings: "./src/js/pages/settings.ts",
            pixivScript: "./src/js/pixiv-script.ts",
            nijieScript: "./src/js/nijie-script.ts"
        },
        output: {
            publicPath: "",
            filename: "[name].js",
            path: path.resolve(__dirname, production ? "release/" + releaseName : "dist")
        },
        resolve: {
            extensions: [".js", ".ts", ".scss", ".html"],
            modules: ["src", "node_modules"]
        },
        module: {
            rules: [
                {
                    test: /\.css$/,
                    use: [
                        "style-loader",
                        "css-loader"
                    ]
                },
                {
                    test: /\.s(a|c)ss$/,
                    use: [
                        "style-loader",
                        "css-loader",
                        "sass-loader"
                    ]
                },
                {
                    test: /\.(png|svg|jpg|gif)$/,
                    use: [
                        "file-loader"
                    ]
                },
                // Loading Semantic UI's fonts in a content script doesn't work,
                // delete all except for the custom font that gets loaded via JS
                {
                    test: /\.(woff|woff2|eot|ttf|otf)$/,
                    use: [
                        "ignore-loader"
                    ]
                },
                {
                    test: /\.ts$/,
                    loader: "ts-loader",
                    options: {
                        transpileOnly: true 
                    }
                },
                {
                    test: /\.html$/,
                    loader: "html-loader"
                }
            ]
        },
        plugins: [
            new CleanWebpackPlugin(),
            new CopyWebpackPlugin({
                patterns: [
                    { from: "src/html/settings.html" },
                    { from: "manifest.json" },
                    { from: "icons", to: "icons" },
                    { from: "icons/icon-128.png", to: "128.png" }
                ]
            }),
            new ForkTsCheckerWebpackPlugin(),
            new DefinePlugin({
                PRODUCTION: JSON.stringify(production),
                UPLOAD_EXTENSION_ID: JSON.stringify(production ? "" : process.env.UPLOAD_EXTENSION_ID)
            })
        ],
        optimization: {
            minimize: production
        }
    }
})
