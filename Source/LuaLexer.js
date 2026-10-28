// Copyright (c) RidT. Licensed under the MIT License, see LICENSE.txt
'use strict';

// Just enough Lua 5.4 lexing to find calls with string literal arguments outside comments.
// Token: { Type: NAME | KEYWORD | STRING | NUMBER | OP, Value, Start, End }, strings also carry
// ContentStart/ContentEnd (the text between the quotes), Closed and Long ([[...]]).

const KEYWORDS = new Set([
    'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in',
    'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while'
]);
const LONG_OPS = ['...', '..', '==', '~=', '<=', '>=', '//', '::', '<<', '>>'];

function isNameStart(c)
{
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}

function isDigit(c)
{
    return c >= '0' && c <= '9';
}

// Level of a long bracket opening at i ([[ = 0, [=[ = 1...), -1 when there is none
function longBracketLevel(text, i)
{
    if(text[i] !== '[')
        return -1;
    let j = i + 1;
    while(text[j] === '=')
        j++;
    return text[j] === '[' ? j - i - 1 : -1;
}

function tokenize(text)
{
    const tokens = [];
    const n = text.length;
    let i = 0;
    while(i < n)
    {
        const c = text[i];
        if(c === ' ' || c === '\t' || c === '\r' || c === '\n')
        {
            i++;
            continue;
        }

        if(c === '-' && text[i + 1] === '-')
        {
            const level = longBracketLevel(text, i + 2);
            if(level >= 0)
            {
                const close = text.indexOf(']' + '='.repeat(level) + ']', i + 4 + level);
                i = close < 0 ? n : close + level + 2;
            }
            else
            {
                const newline = text.indexOf('\n', i);
                i = newline < 0 ? n : newline + 1;
            }
            continue;
        }

        if(c === '"' || c === '\'')
        {
            let j = i + 1;
            let closed = false;
            while(j < n)
            {
                const d = text[j];
                if(d === '\\')
                {
                    j += 2;
                    continue;
                }
                if(d === c)
                {
                    closed = true;
                    break;
                }
                if(d === '\n' || d === '\r')
                    break;
                j++;
            }
            const contentEnd = Math.min(j, n);
            tokens.push({ Type: 'STRING', Value: text.slice(i + 1, contentEnd), Start: i, End: closed ? j + 1 : contentEnd,
                          ContentStart: i + 1, ContentEnd: contentEnd, Closed: closed, Long: false });
            i = closed ? j + 1 : contentEnd;
            continue;
        }

        if(c === '[')
        {
            const level = longBracketLevel(text, i);
            if(level >= 0)
            {
                const open = i + level + 2;
                const closeSequence = ']' + '='.repeat(level) + ']';
                const close = text.indexOf(closeSequence, open);
                const contentEnd = close < 0 ? n : close;
                const end = close < 0 ? n : close + closeSequence.length;
                tokens.push({ Type: 'STRING', Value: text.slice(open, contentEnd), Start: i, End: end,
                              ContentStart: open, ContentEnd: contentEnd, Closed: close >= 0, Long: true });
                i = end;
                continue;
            }
        }

        if(isNameStart(c))
        {
            let j = i + 1;
            while(j < n && (isNameStart(text[j]) || isDigit(text[j])))
                j++;
            const word = text.slice(i, j);
            tokens.push({ Type: KEYWORDS.has(word) ? 'KEYWORD' : 'NAME', Value: word, Start: i, End: j });
            i = j;
            continue;
        }

        if(isDigit(c) || (c === '.' && isDigit(text[i + 1])))
        {
            let j = i + 1;
            while(j < n)
            {
                const d = text[j];
                const exponentSign = (d === '+' || d === '-') && 'eEpP'.includes(text[j - 1]);
                if(!(isNameStart(d) || isDigit(d) || d === '.' || exponentSign))
                    break;
                j++;
            }
            tokens.push({ Type: 'NUMBER', Value: text.slice(i, j), Start: i, End: j });
            i = j;
            continue;
        }

        const op = LONG_OPS.find(o => text.startsWith(o, i)) || c;
        tokens.push({ Type: 'OP', Value: op, Start: i, End: i + op.length });
        i += op.length;
    }
    return tokens;
}

// Index of the token containing offset (binary search), -1 when it falls between tokens
function tokenAt(tokens, offset)
{
    let low = 0;
    let high = tokens.length - 1;
    while(low <= high)
    {
        const mid = (low + high) >> 1;
        const t = tokens[mid];
        if(offset < t.Start)
            high = mid - 1;
        else if(offset > t.End)
            low = mid + 1;
        else
            return mid;
    }
    return -1;
}

module.exports = { tokenize, tokenAt };
