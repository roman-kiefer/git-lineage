import './styles/base.css';
import { bootstrapGraphApp } from './graph/bootstrapGraphApp';

const vscode = acquireVsCodeApi();
bootstrapGraphApp(vscode);
