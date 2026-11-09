#pragma once

// WinRT event-token ABI. The MinGW headers used by Zig omit this SDK header.
typedef struct EventRegistrationToken {
    __int64 value;
} EventRegistrationToken;
