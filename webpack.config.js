const path = require('path');
const glob = require('glob');

const entries = glob.sync(path.resolve(__dirname, 'src/**/*.ts')).reduce((acc, file) => {
  const name = path.relative(path.resolve(__dirname, 'src'), file).replace('.ts', '');
  acc[name] = file;
  return acc;
}, {});

module.exports = {
  mode: 'production',
  entry: entries,
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    libraryTarget: 'commonjs',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'babel-loader',
        exclude: /node_modules/,
      },
    ],
  },
  externals: [/^k6(\/.*)?$/],
  target: 'web',
};
