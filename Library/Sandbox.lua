---@meta SurgeSandbox

-- ==============================================================================
-- The standard library as the Surge script sandbox opens it (ScriptEngine::Initialize):
-- base, math, string, table, utf8, coroutine, package (require resolves script assets only)
-- and a reduced os. There is no io and no debug library. The extension turns the language
-- server's own io/debug/os definitions off, this file declares the os that is left.
-- print() writes into the engine log (Editor Console, logcat on Android).
-- ==============================================================================

--- Time functions only: execute, exit, getenv, remove, rename, tmpname and setlocale are removed.
---@class oslib
os = {}

--- CPU time used by the program, in seconds.
---@return number
---@nodiscard
function os.clock() end

--- Formats a time ("*t" / "!*t" return a table).
---@param format string|nil
---@param time integer|nil
---@return string|osdate
---@nodiscard
function os.date(format, time) end

--- Seconds from t1 to t2.
---@param t2 integer
---@param t1 integer|nil
---@return number
---@nodiscard
function os.difftime(t2, t1) end

--- Current time (no argument) or the time of a date table.
---@param date osdateparam|nil
---@return integer
---@nodiscard
function os.time(date) end

---@class osdate
---@field year integer
---@field month integer
---@field day integer
---@field hour integer
---@field min integer
---@field sec integer
---@field wday integer
---@field yday integer
---@field isdst boolean

---@class osdateparam
---@field year integer|string
---@field month integer|string
---@field day integer|string
---@field hour integer|string|nil
---@field min integer|string|nil
---@field sec integer|string|nil
---@field isdst boolean|nil
