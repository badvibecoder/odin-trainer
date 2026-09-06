// vary.mjs — build-time variation engine for the Odin Trainer.
//
// Given a base Odin snippet, produce N textually-distinct but structurally
// equivalent variations by:
//   1. renaming non-protected identifiers (consistent within the snippet,
//      case-aware, collision-free),
//   2. rotating integer literals (>= 3 for single digits, or any multi-digit),
//   3. rotating "content" string literals (no `: / % . _` — so imports, file
//      paths, format strings, and package names are left alone).
//
// A PROTECTED set holds every Odin keyword, primitive type, builtin, library
// package/proc/type name, and the built-in swizzle components (x y z w), so
// those are never renamed. `main` is also protected.

export const PROTECTED = new Set([
  // keywords / directives
  'package','import','foreign','proc','return','if','else','for','in','not_in',
  'or_else','or_return','when','where','switch','case','break','continue',
  'fallthrough','defer','using','distinct','struct','enum','union','map',
  'bit_set','bit_field','typeid','do','assert','context','nil','true','false',
  'cast','transmute','dynamic','no_nil','partial','soa','rodata','load',
  'load_directory','caller_location','optional_allocator_error','optional_ok',
  'raw_union','private','extra_linker_flags','default_calling_convention','build',
  // primitive types
  'int','i8','i16','i32','i64','i128','uint','u8','u16','u32','u64','u128',
  'uintptr','f16','f32','f64','bool','byte','rune','string','cstring','string16',
  'cstring16','rawptr','any',
  // builtins
  'len','cap','make','append','append_soa','append_nothing','new','free','delete',
  'delete_key','clear','unordered_remove','ordered_remove','min','max','size_of',
  'align_of','type_of','type_info_of','typeid_of','type_info_base','raw_data',
  'copy','pop','push','clamp','swap','abs','require_results','main',
  'start','join','destroy','sleep','Thread','free_all',
  'allocator','temp_allocator','user_ptr','user_index','assertion_failure_proc',
  'logger','random_generator','_internal',
  'Raw_Slice','Raw_String','Raw_Dynamic_Array','Raw_Fixed_Capacity_Dynamic_Array',
  // swizzle / coordinate components (built-in on vector/color types)
  'x','y','z','w','zx','xy','xz','yz','yx','zy','zw','xw','wx','xyz',
  // packages
  'fmt','os','math','rand','time','strings','json','thread','mem','vmem','reflect',
  'slice','runtime','windows','linalg','rl','b2','win','intrinsics','sync','c','base',
  'sort','utf8','core','vendor','libs','base',
  // memory / unit constants
  'Megabyte','Gigabyte','Kilobyte','ERROR_NONE','Allocator_Error','Allocator',
  // library procs (core:*)
  'println','print','printf','printfln','eprintln','eprintf','eprintfln','tprint',
  'tprintf','aprint','aprintf','bprint','bprintf','sbprint','sbprintln','sbprintfln',
  'read_entire_file','write_entire_file','open','close','marshal','unmarshal',
  'builder_make','builder_destroy','write_string','write_int','to_string','clone',
  'clone_to_cstring','clone_to_dynamic','substring_from','rune_size','enum_from_name',
  'enum_field_names','enum_field_values','reinterpret','create','reset','int_max',
  'int31_max','uint32','float64_range','shuffle','now','since','diff',
  'duration_seconds','duration_minutes','duration_milliseconds','time_to_unix',
  'default_context','default_random_generator','trap','tracking_allocator_init',
  'tracking_allocator','tracking_allocator_destroy','arena_allocator',
  'arena_init_growing','arena_init_static','arena_init_buffer','arena_destroy',
  'create_console_logger','destroy_console_logger','create_file_logger',
  'destroy_file_logger','info','warn','error','fatal','panic','debug','sort_by',
  'length','normalize0','sqrt','sqrt',
  // library types
  'Context','Arena','Arena_Kind','Logger','Tracking_Allocator','Random_Generator',
  'Type_Info','Type_Info_Enum','Arena','Allocator','Image','Rect','Rectangle',
  'Color','Texture','Game_Object','Tiles','Slot','MSG','HWND','HINSTANCE',
  'WNDCLASSW','BOOL','LPWSTR','LPCWSTR','INT','UINT','WPARAM','LPARAM','LRESULT',
  'Vector2','Vector3','Circle',
  // raylib
  'InitWindow','SetTargetFPS','WindowShouldClose','BeginDrawing','ClearBackground',
  'EndDrawing','CloseWindow','DrawText','DrawTextPro','DrawRectangleRec',
  'DrawRectangleLinesEx','DrawRectanglePro','DrawCircleV','GetMousePosition',
  'IsMouseButtonPressed','GetMouseWheelMove','GetScreenHeight','LoadImage',
  'UnloadImage','GetImageColor','BLUE','BLACK','WHITE','RED','MAGENTA','YELLOW',
  'GREEN','LEFT','Message','Disconnect','Handshake','None',
  // windows API
  'GetModuleHandleW','RegisterClassW','CreateWindowW','GetMessageW',
  'TranslateMessage','DispatchMessageW','DestroyWindowW','DefWindowProcW',
  'PostQuitMessage','SetWindowTextW','GetWindowTextW','GetWindowTextLengthW',
  'wstring_to_utf8','utf8_to_wstring','WS_OVERLAPPEDWINDOW','WS_VISIBLE','WM_DESTROY',
  // box2d
  'Vec2','WorldId','BodyId','ShapeId','CreateBody','CreateWorld','CreatePolygonShape',
  'CreateCircleShape','DestroyBody','DestroyShape','DestroyWorld','Body_SetTransform',
  'Body_GetPosition','Body_GetRotation','World_Step','MakeBox','MakeCircle',
  'DefaultBodyDef','DefaultShapeDef','DefaultWorldDef','Rot_GetAngle','dynamicBody',
  // misc library members used in snippets
  'WNDCLASSW','lpfnWndProc','lpszClassName','hInstance','CreateWindowW','PostQuitMessage',
]);

const POOLS = {
  upper: ['MAX_VALUE','TOTAL_COUNT','ITEM_COUNT','BASE_AMOUNT','DEFAULT_VALUE','LIMIT_SIZE'],
  cap: ['Item','Entity','Record','Entry','Data','Result','Config','Thing','Value','Note'],
  cap_snake: ['Item_Kind','Entity_Data','Record_Type','Entry_Kind','Data_Type','Item_Record'],
  lower: ['value','count','total','amount','item','data','result','entry','score','size','level'],
  snake: ['item_data','value_list','entry_map','data_store','result_set','count_total','total_sum','score_list'],
};

const INT_POOL = [7, 42, 13, 100, 3, 9, 25, 64, 512, 2, 4, 10, 200, 128];
const STR_POOL = ['apple','gadget','widget','orange','storm','ember','raven','stone','field','cloud','branch','shadow','hollow','ridge','meadow','timber'];

function caseClass(tok) {
  if (/^[A-Z]/.test(tok) && tok === tok.toUpperCase()) return 'upper';
  if (/^[A-Z]/.test(tok)) return tok.includes('_') ? 'cap_snake' : 'cap';
  return tok.includes('_') ? 'snake' : 'lower';
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function tokens(code) {
  return [...new Set(code.match(/[A-Za-z_]\w*/g) || [])];
}

// Produce the index-th variation of `base`. index 0 returns the base verbatim.
export function varyTarget(base, index) {
  if (index === 0) return base;

  const rename = {};
  const used = new Set();
  for (const tok of tokens(base)) {
    if (PROTECTED.has(tok)) continue;
    if (/^[A-Z]$/.test(tok)) continue; // single uppercase letter = type parameter
    const pool = POOLS[caseClass(tok)];
    if (!pool || pool.length < 2) continue;
    let off = 0;
    let rep;
    do {
      rep = pool[(hash(tok) + index + off) % pool.length];
      off++;
    } while (used.has(rep) && off < pool.length);
    used.add(rep);
    rename[tok] = rep;
  }

  let code = base;
  const toks = Object.keys(rename).sort((a, b) => b.length - a.length);
  for (const t of toks) {
    code = code.replace(new RegExp('\\b' + esc(t) + '\\b', 'g'), rename[t]);
  }

  // integer literals: multi-digit always; single-digit only >= 3
  code = code.replace(/\b(\d{2,}|[3-9])\b/g, (m) => String(INT_POOL[(hash(m) + index) % INT_POOL.length]));

  // content string literals (exclude imports/paths/format strings)
  code = code.replace(/"([A-Za-z0-9][A-Za-z0-9 ,'!?;]*[A-Za-z0-9'!?])"/g, (m, inner) => {
    if (/[:/%.]/.test(inner)) return m;
    return '"' + STR_POOL[(hash(inner) + index) % STR_POOL.length] + '"';
  });

  return code;
}

// Genericize a drill instruction so it describes the concept without pinning
// specific identifiers or literal values (so it's true for every variation).
export function genericizeInstruction(s) {
  let t = String(s);
  t = t.replace(/(?<![\-\[])\b\d+(?:\.\d+)?\b(?!\])/g, 'a value'); // not array sizes / UTF-8
  t = t.replace(/\bDeclare an? [A-Za-z_0-9]+ variable\b/g, 'Declare a variable');
  t = t.replace(/\bDeclare (?!an?\b|the\b)[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?\b/g, 'Declare a variable');
  t = t.replace(/\bWrite (?!an?\b|the\b)[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?\b/g, 'Write a procedure');
  t = t.replace(/\bCall (?!an?\b|the\b)[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?\b/g, 'Call a procedure');
  t = t.replace(/\bCreate (?!an?\b|the\b)[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?\b/g, 'Create a value');
  t = t.replace(/\bDefine (?!an?\b|the\b)[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?\b/g, 'Define a type');
  t = t.replace(/\bMake (?!an?\b|the\b)[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?\b/g, 'Make a value');
  t = t.replace(/\bUse (?!an?\b|the\b)[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?\b/g, 'Use a value');
  t = t.replace(/value a value/g, 'a value');
  t = t.replace(/a value a value/g, 'a value');
  t = t.replace(/\ban? [A-Z][A-Za-z_]*'s\b/g, 'its');

  // Manual cleanups for phrasings the rules above can't safely derive.
  const CLEANUPS = {
    'Declare a variable and assign the integer a value': 'Declare an int variable and assign it a value',
    'Declare a variable from a a value literal (type inferred)': 'Declare an f32 variable from a literal (type inferred)',
    'Declare a variable, and a decimal_number as f32, both equal to a value': 'Declare two f32 variables, both equal to a value',
    'Assign a value to decimal_number (type inferred)': 'Assign a value to an f32 variable (type inferred)',
    'Declare a constant CONSTANT_NUMBER with a value': 'Declare a constant with a value',
    'Assign a value to number': 'Assign a value to a variable',
    'Write a procedure, returning whether number > compare_to': 'Write a procedure returning whether one value is greater than another',
    'Call a procedure(a value, a value) and store the result': 'Call a procedure with two values and store the result',
    'An if that runs when some_variable equals a value': 'An if that runs when a condition is true',
    'Count to a value with a loop condition': 'Count with a loop condition',
    'Count to a value with a C-style for loop': 'Count with a C-style for loop',
    'Count to a value with a for-in over an exclusive range': 'Count with a for-in over an exclusive range',
    'Count to a value with a for-in over an inclusive range': 'Count with a for-in over an inclusive range',
    'Skip a value with continue inside a loop': 'Skip an iteration with continue',
    'Declare a fixed array of a value ints and initialize it': 'Declare a fixed array and initialize it',
    'Read the third element of ten_ints': 'Read the third element of a fixed array',
    'Set the element at index a value of ten_ints to a value': 'Set an element of a fixed array by index',
    'Iterate over ten_ints with a for-in loop': 'Iterate over a fixed array with a for-in loop',
    'Iterate over ten_ints in reverse': 'Iterate over a fixed array in reverse',
    'Write the array_demo program: array, loop, if, and is_bigger_than': 'Write a program with an array, a loop, an if, and a comparison procedure',
    'Define a type Rectangle struct with x, y, width, height': 'Define a rectangle struct with x, y, width, height',
    'Create a rect with named fields width and height': 'Create a struct value with named fields',
    'Create a rect positionally with all four values': 'Create a struct value positionally',
    'Reassign rect fields with a struct literal': 'Reassign fields with a struct literal',
    'Define a type and a Person that contains one': 'Define a stats struct and a struct that contains one',
    'Create a Person with nested stats and a name': 'Create a value with nested stats and a name',
    'Define a Person whose stats field uses using': 'Define a struct whose field uses using',
    'Use a value using fields: health and age': 'Use flattened fields',
    'Define a Computer_Type enum with three variants': 'Define an enum with three variants',
    'Assign the Mainframe variant with a dot': 'Assign an enum variant with a dot',
    'Assign the Mainframe variant with the full name': 'Assign an enum variant with the full name',
    'Switch over a Computer_Type value': 'Switch over an enum value',
    'Declare an enum with explicit numbering starting at a value': 'Declare an enum with explicit numbering',
    'Define a My_Union union and assign it an int value': 'Define a union and assign it an int value',
    'Reassign a union to a Person_Data struct': 'Reassign a union to a struct value',
    'Take a pointer to number, pass it to increment_number, and print number': 'Take a pointer to a value, pass it to a procedure, and print it',
    'Define a type with name, age, and a Cat_Color enum': 'Define a struct with name, age, and a color enum',
    'Create a value, call process_cat_birthday, and print the new age': 'Create a value, call a procedure, and print the result',
    'Take the address of a dereferenced pointer (both refer to number)': 'Take the address of a dereferenced pointer',
    'Preallocate a dynamic array with capacity a value': 'Preallocate a dynamic array with a capacity',
    'Preallocate a dynamic array with length a value': 'Preallocate a dynamic array with a length',
    'Write a procedure that allocates and initializes a Cat': 'Write a procedure that allocates and initializes a struct',
    'Slice the first a value elements of a fixed array': 'Slice a prefix of a fixed array',
    'Slice from index a value to the end': 'Slice from an index to the end',
    'Slice a value elements at a time in a loop': 'Slice in chunks in a loop',
    'Write a procedure that takes a []Cat slice': 'Write a procedure that takes a slice of structs',
    'Write a procedure appending to a ^[dynamic]Cat': 'Write a procedure appending to a dynamic-array pointer',
    'Use a value for dynamically allocated map keys': 'Use cloned strings for map keys',
    'Initialize a static arena with a value GB': 'Initialize a static arena with a reserve size',
    'Write a procedure returning (Cat, bool)': 'Write a procedure returning a value and a bool',
    'Use a value in an update proc': 'Use the enum dropdown in an update proc',
    'Append Person values directly (cache-friendly)': 'Append struct values directly (cache-friendly)',
    'Declare a variable append to a #soa dynamic array': 'Declare and append to a #soa dynamic array',
  };
  return CLEANUPS[t] || t;
}

// --- self-test -------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const samples = [
    'number := 7',
    'delete(dyn_arr)',
    'increment_number :: proc(num: ^int) {\n\tnum^ += 1\n}',
    'Cat :: struct {\n\tname: string,\n\tage: int,\n}',
    'for i := 0; i < 10; i += 1 {\n\tfmt.println(i)\n}',
    'position := Vector3 {7, 1, 2}\nzx_pos := position.zx',
    'str := "Hellope!"\nfmt.println(str)',
    'age_by_name["Karl"] = 35\nage_by_name["Sven"] = 7',
    'clamp :: proc(val: $T, min: T, max: T) -> T {\n\tif val <= min {\n\t\treturn min\n\t}\n\treturn val\n}',
    'for key, value in some_map {\n\tfmt.println(key, value)\n}',
  ];
  for (const s of samples) {
    console.log('\n=== BASE ===\n' + s);
    for (let i = 1; i <= 3; i++) console.log(`--- v${i} ---\n` + varyTarget(s, i));
  }
  console.log('\n--- instruction genericization ---');
  for (const ins of [
    'Declare number as an int and assign it 7',
    'Write increment_number that adds 1 through a ^int pointer',
    'Call my_proc with a named argument',
    'Write process_cat_birthday that increments a Cat\'s age through a pointer',
    'Declare an f32 variable and assign 7.42',
  ]) console.log(ins + '  =>  ' + genericizeInstruction(ins));
}
